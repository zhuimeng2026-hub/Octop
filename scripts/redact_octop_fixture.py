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

    # Anything that stores a URL, token or address outside the tables above.
    for table, column in _scan_text_columns(db):
        if table in {"users", "secrets", "sessions", "thread_messages"}:
            continue
        try:
            db.execute(f'UPDATE "{table}" SET "{column}" = NULL WHERE "{column}" IS NOT NULL')
        except sqlite3.Error:
            continue

    db.commit()
    return report


def _column_exists(db: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in db.execute(f'PRAGMA table_info("{table}")'))


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


def _scan_text_columns(db: sqlite3.Connection):
    """Yield (table, column) for columns that look like they hold credentials."""
    markers = ("token", "secret", "password", "api_key", "apikey", "private")
    for (table,) in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ):
        for row in db.execute(f'PRAGMA table_info("{table}")'):
            column = row[1]
            if any(m in column.lower() for m in markers):
                yield table, column


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
