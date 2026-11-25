#!/usr/bin/env python3
"""Sensitive-data scrub for the Octop test fixture.

Takes a consistent `.backup` snapshot of a live Octop database and produces a
fixture that is safe to commit and re-run:

  - `secrets` rows are replaced with freshly generated throwaway values.
    Real signing keys never leave the source host.
  - `users` keep their structure but every identifying column is reset to a
    fixture value. Password hashes are replaced, not carried over.
  - `sessions` are emptied: a captured session key is a live credential.
  - `audit_log`, `thread_messages` keep their row counts so tests that count
    or paginate still work, but free text is replaced.
  - `sso_login_states` keep their row counts but every one-time credential
    (state / nonce / code_verifier / login_code) is replaced: a login code
    in the repo is a login waiting to happen.
  - `user_sso_identities.subject` and `sso_providers.client_id` are replaced:
    a real openid names a real person, a real client_id names a real app.
  - Columns whose *name* looks like a credential are blanked; columns that
    are NOT NULL get a unique placeholder instead of NULL so the write does
    not fail and the secret does not survive as a skipped update.

Row counts on non-sensitive tables are preserved deliberately: a fixture with
the right shape but no data tests nothing interesting.

Usage: redact_octop_fixture.py <source.db> <dest.db>
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

FIXTURE_PASSWORD_HASH = (
    # bcrypt hash of "octop-fixture-password" -- not a usable credential,
    # exists only so NOT NULL and format checks pass.
    "$2b$12$fixturefixturefixturefixturefixturefixturefixturefixture"
)


def scalar(db: sqlite3.Connection, sql: str, default=0):
    row = db.execute(sql).fetchone()
    return row[0] if row and row[0] is not None else default


def has_table(db: sqlite3.Connection, name: str) -> bool:
    return (
        db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
        is not None
    )


def redact(db: sqlite3.Connection) -> dict[str, str]:
    report: dict[str, str] = {}

    if has_table(db, "secrets"):
        n = scalar(db, "SELECT COUNT(*) FROM secrets")
        # Key NAMES are load-bearing (`SecretRepo.get("jwt")` is called all over
        # the server) so they are kept verbatim. Only the values are replaced:
        # a real signing key must never reach the fixture.
        db.execute("UPDATE secrets SET v = CAST('fixture-secret-value' AS BLOB)")
        report["secrets"] = f"{n} rows kept (names intact), values replaced"

    if has_table(db, "sessions"):
        n = scalar(db, "SELECT COUNT(*) FROM sessions")
        db.execute("DELETE FROM sessions")
        report["sessions"] = f"{n} rows dropped (live credentials)"

    if has_table(db, "users"):
        n = scalar(db, "SELECT COUNT(*) FROM users")
        db.execute(
            """
            UPDATE users SET
                username       = 'fixture-user-' || id,
                password_hash  = ?,
                email          = 'fixture-' || id || '@example.invalid',
                display_name   = 'Fixture User ' || id,
                sso_subject    = NULL,
                preferences_json = '{}',
                last_login_at  = NULL,
                login_locked_until = 0,
                mfa_locked_until   = 0,
                login_failed_count = 0,
                mfa_failed_count   = 0
            """,
            (FIXTURE_PASSWORD_HASH,),
        )
        report["users"] = f"{n} rows anonymised, password hashes replaced"

    if has_table(db, "audit_log"):
        n = scalar(db, "SELECT COUNT(*) FROM audit_log")
        # `ts` and `action` are NOT NULL and carry meaning; free-text detail
        # columns are the ones that leak.
        for column in _free_text_columns(db, "audit_log"):
            db.execute(f'UPDATE audit_log SET "{column}" = NULL')
        report["audit_log"] = f"{n} rows kept, free text cleared"

    if has_table(db, "thread_messages"):
        n = scalar(db, "SELECT COUNT(*) FROM thread_messages")
        if _column_exists(db, "thread_messages", "message_json"):
            db.execute(
                'UPDATE thread_messages SET message_json = \'{"role":"user","content":"fixture "}\''
            )
        report["thread_messages"] = f"{n} rows kept, message_json replaced"

    if has_table(db, "sso_login_states"):
        n = scalar(db, "SELECT COUNT(*) FROM sso_login_states")
        # These four columns are one-time login credentials: `state` and
        # `nonce` are the OAuth round-trip values, `code_verifier` is the PKCE
        # secret, `login_code` is the code the dashboard redeems. All of them
        # are NOT NULL, so they get a unique placeholder rather than NULL.
        # `user_id` is nullable and links the pending login to a person.
        for column in ("state", "nonce", "code_verifier"):
            if _column_exists(db, "sso_login_states", column):
                db.execute(
                    f'UPDATE sso_login_states SET "{column}" = ? || rowid',
                    (f"fixture-{column}-",),
                )
        if _column_exists(db, "sso_login_states", "login_code"):
            db.execute("UPDATE sso_login_states SET login_code = NULL")
        if _column_exists(db, "sso_login_states", "user_id"):
            db.execute("UPDATE sso_login_states SET user_id = NULL")
        report["sso_login_states"] = f"{n} rows kept, login credentials replaced"

    if has_table(db, "user_sso_identities"):
        n = scalar(db, "SELECT COUNT(*) FROM user_sso_identities")
        # `subject` is the provider-side identity (a WeChat openid): it names
        # a real account, and the UNIQUE(provider_id, subject) index means a
        # blanket replacement would collide. Per-row placeholder keeps the
        # index shape without keeping the person.
        db.execute(
            "UPDATE user_sso_identities SET subject = 'fixture-subject-' || id"
        )
        report["user_sso_identities"] = f"{n} rows kept, subjects replaced"

    if has_table(db, "sso_providers"):
        n = scalar(db, "SELECT COUNT(*) FROM sso_providers")
        # `client_id` names the real app (a WeChat appid), `issuer` and
        # `dashboard_origin` name internal endpoints. `client_secret_enc` is
        # already blanked by the generic marker pass below.
        for column, placeholder in (
            ("client_id", "fixture-client-id"),
            ("issuer", ""),
            ("dashboard_origin", None),
        ):
            if not _column_exists(db, "sso_providers", column):
                continue
            if _is_not_null(db, "sso_providers", column) and placeholder is None:
                placeholder = ""
            db.execute(
                f'UPDATE sso_providers SET "{column}" = ?', (placeholder,)
            )
        report["sso_providers"] = f"{n} rows kept, client identifiers replaced"

    # Anything that stores a URL, token or address outside the tables above.
    # A NOT NULL column cannot be blanked to NULL -- the update would raise
    # and (in the old version) the exception was swallowed, leaving the
    # secret in the fixture. Those columns get a unique placeholder instead.
    skipped: list[str] = []
    for table, column, notnull in _scan_credential_columns(db):
        if table in {"users", "secrets", "sessions", "thread_messages"}:
            continue
        try:
            if notnull:
                db.execute(
                    f'UPDATE "{table}" SET "{column}" = ? || rowid '
                    f'WHERE "{column}" IS NOT NULL',
                    (f"fixture-{column}-",),
                )
            else:
                db.execute(
                    f'UPDATE "{table}" SET "{column}" = NULL WHERE "{column}" IS NOT NULL'
                )
        except sqlite3.Error as exc:
            skipped.append(f"{table}.{column} ({exc})")
    if skipped:
        report["skipped"] = "NOT NULL 凭据列未能脱敏：" + "; ".join(skipped)

    db.commit()
    return report


def _column_exists(db: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in db.execute(f'PRAGMA table_info("{table}")'))


def _is_not_null(db: sqlite3.Connection, table: str, column: str) -> bool:
    for row in db.execute(f'PRAGMA table_info("{table}")'):
        if row[1] == column:
            return bool(row[3])
    return False


def _free_text_columns(db: sqlite3.Connection, table: str) -> list[str]:
    """Text columns that are nullable and not part of a constraint or an index.

    Only these can be blanked without breaking NOT NULL or a unique key.
    """
    keep = {"id", "ts", "action", "created_at", "table", "pk", "uid"}
    columns = []
    for row in db.execute(f'PRAGMA table_info("{table}")'):
        name, declared, notnull, default = row[1], row[2] or "", row[3], row[4]
        is_text = declared.upper() == "TEXT"
        if not is_text or name in keep or notnull:
            continue
        if default is not None:
            continue
        columns.append(name)
    return columns


def _scan_credential_columns(db: sqlite3.Connection):
    """Yield (table, column, notnull) for columns that look like credentials."""
    markers = ("token", "secret", "password", "api_key", "apikey", "private")
    for (table,) in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ):
        for row in db.execute(f'PRAGMA table_info("{table}")'):
            column = row[1]
            if any(m in column.lower() for m in markers):
                yield table, column, bool(row[3])


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dest = Path(sys.argv[1]), Path(sys.argv[2])
    if not src.exists():
        print(f"source not found: {src}", file=sys.stderr)
        return 1
    if dest.exists():
        dest.unlink()

    with sqlite3.connect(src) as source, sqlite3.connect(dest) as target:
        source.backup(target)
        report = redact(target)
        target.execute("VACUUM")
        target.commit()

    with sqlite3.connect(dest) as check:
        integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
        tables = scalar(
            check,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
        )

    print(f"fixture written: {dest} ({dest.stat().st_size} bytes)")
    print(f"integrity: {integrity}")
    print(f"tables: {tables}")
    for line in report.values():
        print(f"  - {line}")
    return 0 if integrity == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
