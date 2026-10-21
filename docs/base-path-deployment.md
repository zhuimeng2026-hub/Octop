# 子路径部署（base path）

> Octop 可以整体挂在一个 URL 子路径下，例如 `https://host/videogen`。
> 后端只在该前缀下提供服务，前端按同一前缀构建。

---

## 一、概览

| 项 | 值 |
|---|---|
| 配置项 | `config.json` → `base_path` |
| 环境变量 | `OCTOP_BASE_PATH`（覆盖 `config.json`） |
| 形态 | 有前导斜杠、无尾斜杠，例如 `/videogen`；空字符串 = 根路径部署 |
| 默认 | `""`（根路径部署，行为与旧版本完全一致） |

启用后：

- `/videogen/api/health` 正常处理；
- `/api/health`（不带前缀）返回 **404**；
- 后端内部把前缀从 `scope["path"]` 剥掉，路由匹配逻辑一字未改；
- `scope["root_path"]` 设为该前缀，因此 `request.url_for()`、重定向、OpenAPI
  `servers` 等由 Starlette/FastAPI 生成的地址都带上前缀；
- 发给浏览器的根绝对 URL（媒体预览/下载、下载链接、头像、插件/专家图标、
  workspace 媒体链接）都带上前缀。

---

## 二、怎么配

### 2.1 `config.json`

```json
{
  "base_path": "/videogen"
}
```

`config.json` 首次启动时由程序生成默认值；手改这一项即可。改完重启服务。

### 2.2 环境变量

```bash
export OCTOP_BASE_PATH=/videogen
```

环境变量优先级高于 `config.json`（与 `OCTOP_*` 系列的既有约定一致）。
systemd 部署示例：

```ini
[Service]
Environment=OCTOP_BASE_PATH=/videogen
```

### 2.3 取值规则

- `""`（或留空）→ 根路径部署，行为与未开启该特性时完全一致；
- `videogen` → 归一化为 `/videogen`（自动补前导斜杠）；
- `/videogen/` → 归一化为 `/videogen`（自动去掉尾斜杠）；
- 含 `?`/`#` 或 `..` 段的值非法：启动时记 ERROR 日志并回退到根路径部署
  （不会静默地挂到错误的前缀上，也不会让服务起不来）。

---

## 三、nginx 配置（**不要剥前缀**）

后端自己处理 `/videogen` 前缀，nginx 必须把前缀原样透传：

```nginx
location /videogen/ {
    proxy_pass http://127.0.0.1:8088;   # 注意：没有尾斜杠
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;           # SSE / WebSocket
    proxy_buffering off;                # SSE
}
```

要点：

- **`proxy_pass` 后面不要加尾斜杠。** 写成 `proxy_pass http://127.0.0.1:8088/;`
  会让 nginx 把 `/videogen/` 重写成 `/`，前缀被吃掉，后端就 404 了。
- `location` 用前缀匹配（`/videogen/`）即可，不要写成精确路径。
- `X-Forwarded-Proto` / `X-Forwarded-Host` 要透传：SSO 回调、下载链接、
  OAuth redirect_uri 都依赖公网 origin 的判定。
- WebSocket（chat / bridge）与 SSE 需要 `Upgrade` / `Connection` 头和足够长的
  `proxy_read_timeout`。

### 3.1 从"nginx 剥前缀"的旧部署迁移

旧做法是让 nginx 吃掉前缀（`proxy_pass http://127.0.0.1:8088/;`，带尾斜杠），
后端始终看到 `/api/...`。改用本特性时这两步必须**同时**做，否则必然 404：

1. nginx：`proxy_pass http://127.0.0.1:8088;` —— 去掉尾斜杠，前缀原样透传；
2. 后端：`base_path` / `OCTOP_BASE_PATH` 设为同一个前缀。

反过来（后端设了前缀、nginx 还在剥前缀）也会 404：后端收到的是
`/api/health`，而它只认 `/videogen/api/health`。

---

## 四、前端怎么配

前端构建要带同一个前缀，两个地方：

1. **API 基址**：`dashboard/vite.config.ts` 读取 `BASE_URL` 环境变量并注入为
   全局常量，`dashboard/src/api/config.ts` 用它拼 API 路径。

   ```bash
   cd dashboard
   BASE_URL=/videogen npm run build
   ```

   拼出来的地址形如 `/videogen/api/agents`（相对同源）。留空 = 同源根路径部署。

2. **静态资源基址**：`dashboard/vite.config.ts` 用同一个 `BASE_URL` 推导 Vite 的
   `base`（带尾斜杠），并重写 manifest 的 `start_url` / `scope` / 图标路径。
   产物里的资源引用形如 `/videogen/assets/...`，与后端前缀一致。

> 前端产物是构建期决定的：`BASE_URL` 与后端的 `base_path` 必须一致；
> 改了后端前缀就要重新构建前端。

---

## 五、验证

```bash
# 前缀下的健康检查：200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8088/videogen/api/health

# 不带前缀：404
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8088/api/health

# OpenAPI（需 enable_api_docs=true）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8088/videogen/api/openapi.json
```

单元测试：

```bash
uv run pytest tests/unit/api/test_base_path_deployment.py tests/unit/infra/test_base_path.py -q
```

---

## 六、已知限制

| 限制 | 说明 |
|---|---|
| 前缀是进程级 | 一个 Octop 进程只服务一个前缀；同一域名下多个前缀需要多个实例。 |
| 前缀变更需重建前端 | 前端产物里的 `BASE_URL` / Vite `base` 是构建期常量。 |
| 存量数据里的绝对路径不迁移 | 数据库里已经存下来的头像/图标 URL（例如 agent registry 的 `icon_url`）是旧前缀的字符串，改前缀后需要重新绑定一次。 |
| ACME HTTP-01 走 80 端口 companion | 主应用的 `/.well-known/acme-challenge` 路由在子路径下不可达；签发证书请用内建 companion 监听（80 端口）或让 nginx 直接应答该路径。 |
| `X-Forwarded-Prefix` 不参与 | 后端不读这个头，前缀只由 `base_path` / `OCTOP_BASE_PATH` 决定。 |
| Bridge 对端 | 对端 Octop 也部署在子路径时，走 Bridge 隧道的是 `/api/...` 内部路径（不带前缀），隧道本身不感知前缀。 |

---

## 七、故障排查

| 现象 | 原因 |
|---|---|
| `/videogen/api/health` 404 | nginx 剥了前缀（`proxy_pass` 带了尾斜杠），或后端没配 `base_path`。 |
| `/api/health` 200（应 404） | 后端没启用子路径（`base_path` 未生效），检查 `OCTOP_BASE_PATH` 与 `config.json`。 |
| 页面能开但所有接口 404 | 前端 `BASE_URL` 与后端前缀不一致。 |
| 静态资源 404 | 前端构建时的 `BASE_URL` 与后端前缀不一致（产物里还是 `/assets/...`）。 |
| 登录后立刻掉线 / SSO 回调失败 | cookie path、redirect_uri 没带前缀（老版本后端不支持子路径）。 |
