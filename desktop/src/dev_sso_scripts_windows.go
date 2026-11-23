//go:build windows

package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed dev_sso_local.js
var devSsoLocalScript string

//go:embed dev_sso_auth.js
var devSsoAuthScript string

func devSsoLocalJS(origin, base, nonce string) string {
	return fmt.Sprintf("(%s)(%s,%s,%s)", devSsoLocalScript, jsonString(origin), jsonString(base+"/login"), jsonString(nonce))
}

func devSsoAuthJS(origin, base, nonce, id, kind string) string {
	return fmt.Sprintf("(%s)(%s,%s,%s,%s,%s)", devSsoAuthScript, jsonString(origin), jsonString(base), jsonString(nonce), jsonString(id), jsonString(kind))
}

func devSsoResultJS(origin, base, id, code, failure string) string {
	detail, _ := json.Marshal(map[string]string{"id": id, "code": code, "error": failure})
	return fmt.Sprintf(
		`if (location.origin === %s && location.pathname === %s) {
			window.dispatchEvent(new CustomEvent("octop:dev-sso-response", { detail: %s }));
		}`,
		jsonString(origin), jsonString(base+"/login"), detail,
	)
}
