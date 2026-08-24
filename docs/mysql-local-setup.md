# MySQL 本机初始化

v1.3 的第一验收环境是 MySQL Community Server 9.7.2 LTS。网站运行时使用专用应用账号，不使用 Workbench 的 `root` 账号；`root` 或具备等价权限的维护者账号只用于 `db:init`。

## 配置

在本机 `.env.local` 填写以下变量。`.env.example` 只保留占位符，不能放入真实密码。

- `MYSQL_HOST`、`MYSQL_PORT`：应用连接的 MySQL 地址和端口。
- `MYSQL_DATABASE`：项目专用数据库名，不能是 MySQL 系统库。
- `MYSQL_USER`、`MYSQL_PASSWORD`：网站运行时使用的专用账号和密码。
- `MYSQL_APP_HOST`：该账号允许从哪个主机登录；本机默认 `localhost`。
- `MYSQL_ADMIN_USER`、`MYSQL_ADMIN_PASSWORD`：只供初始化命令使用的维护者账号。
- `MYSQL_REQUIRED_VERSION`：第一验收环境精确固定为 `9.7.2`，命令会拒绝其他版本，避免未经验证的版本被当成已支持。

## 命令

```powershell
npm run db:init
npm run verify:mysql-init
```

`db:init` 可以重复执行：它会创建项目数据库、维护 `schema_migrations`，并只向配置指定的专用应用账号授予项目库 DML 权限，再实际用该账号连接一次。已有账号必须只服务本项目（仅有 `USAGE` 和本项目 DML）；否则命令会拒绝修改它，避免破坏其他服务。它不会删除已有业务数据，也不会修改其他数据库；应用账号不能与维护者账号相同。

`verify:mysql-init` 会连续执行两次初始化，检查迁移记录和应用账号授权。MySQL 未启动、环境变量缺失、账号密码错误、权限不足或版本不为 9.7.2 时，命令会失败并给出面向维护者的定位信息；用户页面不会显示这些技术细节。

当前 #01 仅增加 MySQL 基础设施，应用 API 仍继续使用 MongoDB，直至后续迁移票逐步替换。
