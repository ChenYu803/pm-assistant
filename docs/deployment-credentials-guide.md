# IdeaStage 部署凭据：用途、保存与找回

> 2026-11-02 更新：当前 SSH 私钥以部署记录的 D:/SSH_pem/IdeaStage_SSH_2026.pem 为准，旧 Downloads 路径已不存在。v1.44 正常注册不再使用下文历史 REGISTRATION_INVITE_CODE；新增 RESEND_API_KEY 与 EMAIL_FROM，当前线上均未配置。邮件配置与收信验收见 [邮箱认证记录](verification/v144-email-auth.md)。下方原始配置生成命令不可在已有配置上重跑。


更新日期：2026-10-21。本文是项目内的持久记录，不依赖聊天历史。真实密码不填写在本文或 Git 中。

本次主机、账号、操作证据及逐项备份状态统一记录在 [部署记录与备份清单](deployment-record-2026-10-21.md)；本文提供凭据的用途与操作参考。

## 当前执行状态

- 服务器：`101.33.79.30`；SSH 用户：`ubuntu`；域名：`ideastage.top`。
- 用户反馈代码目录权限设置、缓存目录权限设置和两份配置模板安装命令无报错。尚未取得目标机权限检查回执。
- 用户确认服务器生成命令成功；随后只读检查确认 `runtime.env` 权限为 `0600`，三个目标字段均为 64 位十六进制值，检查没有显示真实值。
- Windows 已安装 KeePassXC 2.7.12；用户确认本地加密保险箱中的测试记录保存后可关闭并重新打开。保险箱可用已验证。
- `maintenance.env` 权限为 0600；临时 `ideastage_bootstrap` 已完成初始化后删除，密码已从配置中清除。当前配置使用独立 `ideastage_migration` 账号，连接及结构迁移入口已实测通过。
- 目标 MySQL 9.7.4 初始化与生产数据库检查通过；已生成加密备份、下载到 Windows、核对哈希并在随机隔离库恢复验证。每日备份 timer 已启用。
- 用户已将运行配置三项值及临时引导账号密码录入 KeePassXC，并确认保存后关闭/重开保险箱仍可读取。root 密码现单独保存在“MySQL root”条目，迁移账号密码单独保存在“MySQL 迁移账号”条目；历史引导账号条目未覆盖。32 字节备份解密密钥有独立保险箱条目，并存于服务器 `/etc/ideastage/backup.key`（0600）。不得把真实值发到项目文档。

## 为什么要生成这三个值

网站代码已经构建完成，但网站仍需要知道如何保护登录、用哪个密码连接数据库、允许谁注册。这些设置写在服务器的 `/etc/ideastage/runtime.env` 中；`.env` 在这里就是保存“设置名=设置值”的文本配置文件。

| 设置名 | 用途 | 保存位置 | 丢失或更换的影响 |
|---|---|---|---|
| `AUTH_SECRET` | 保护网站登录会话；不是用户登录密码，也不是 SSH 密钥 | `runtime.env` | 更换后已有登录会话通常失效，用户需重新登录；不会因此删除用户数据 |
| `MYSQL_PASSWORD` | 网站专用数据库账号 `ideastage_app` 的密码；不是 MySQL root 密码 | `runtime.env` | 必须与数据库内该账号密码一致；只改文件会导致连接失败 |
| `REGISTRATION_INVITE_CODE` | 新用户注册时填写的共享邀请码 | `runtime.env` | 更换后新注册使用新码，已有账号不因此被删除 |

每项分别随机生成，使用 Python 的 `secrets` 模块，每项为 32 随机字节对应的 64 位十六进制文本。生成命令直接写文件，不打印真实值；这表示“保存但不在终端显示”，不表示“不作记录”。

配置文件持久保存在服务器磁盘，退出 SSH、重启电脑或丢失聊天不会让它消失。服务器磁盘丢失则仍可能丢失文件，因此文件留存不等于完成备份。

## 生成命令留档

仅在配置文件仍为初始模板时执行。代码只填写上述三项，不创建 MySQL 账号或数据库。任一预期占位内容不符就停止，避免重复生成覆盖原值。不要重新复制模板覆盖已经填写的配置。

在服务器 SSH 终端执行，从第一行至最后一行 `PY` 一起复制：

```bash
sudo python3 - <<'PY'
from pathlib import Path
import secrets

path = Path("/etc/ideastage/runtime.env")
text = path.read_text()
fields = {
    "AUTH_SECRET": "REPLACE_WITH_RANDOM_64_HEX",
    "MYSQL_PASSWORD": "REPLACE_WITH_RANDOM_64_HEX",
    "REGISTRATION_INVITE_CODE": "REPLACE_WITH_RANDOM_INVITE_CODE",
}

for key, placeholder in fields.items():
    if text.count(f"{key}={placeholder}") != 1:
        raise SystemExit(f"停止：{key} 已填写或模板不符，没有修改文件。")

for key, placeholder in fields.items():
    text = text.replace(f"{key}={placeholder}", f"{key}={secrets.token_hex(32)}")

path.write_text(text)
path.chmod(0o600)
print("成功：三个独立随机值已保存，配置文件仅管理员可读写。")
PY
```

当前只有命令留档，不是服务器执行证明。

## 保存位置与找回入口

| 内容 | 真实值存放位置 | 项目记录与恢复方式 |
|---|---|---|
| 网站配置及上述三个值 | 服务器 `/etc/ideastage/runtime.env` | 本文记录用途和路径；通过服务器管理员权限查看；完整加密备份包含此文件 |
| 数据库迁移凭据 | 服务器 `/etc/ideastage/maintenance.env` | `ideastage_migration` 凭据另存 KeePassXC；完整网站备份不包含此文件；临时引导账号已删除且旧密码已清除 |
| 备份解密密钥 | 服务器 `/etc/ideastage/backup.key` | 32 字节密钥另存 KeePassXC；不放进由它加密的备份包 |
| SSH 私钥 | 用户已保存于 Windows `C:\Users\Administrator\Downloads\TheFirst.pem` | 不放 Git；需要服务器之外的安全副本，副本状态尚未核验 |
| MySQL root 密码 | KeePassXC “IdeaStage MySQL root” | 仅管理员连接使用，不填网站运行配置；当前已验证与服务器一致 |

服务器仍可登录且有管理员权限时，可以用 `sudo less /etc/ideastage/runtime.env` 查看已保存的设置。该操作会显示真实值，只在自己的终端私下查看，不上传截图；按 `q` 退出。没有显示密码的生成命令，也不妨碍以后这样找回。

## 备份顺序与验收

1. 已确认三个运行随机值生成并通过 KeePassXC 关闭/重开可读验证。
2. 已将迁移账号凭据与备份密钥另存到 KeePassXC；临时引导账号清理后，从服务器维护配置清除旧密码。
3. 目标机初始化后已运行完整加密备份并拉取到 Windows，索引 SHA-256 校验通过；解密检查与随机隔离库恢复验收通过。每日 systemd timer 已启用。
4. 加密包包含数据库、`runtime.env`、代码和元数据；不包含 `maintenance.env`、MySQL 系统账号、SSH 私钥、root 密码或备份解密密钥。这些另行保存或按手册重建，不假设它们已经随包备份。
5. 配置变更后同步更新安全副本和项目中的非敏感变更记录；首次及每月完成恢复演练。

真正找回原随机值需要原配置或其安全副本。重新运行随机生成不是恢复原值；若原值彻底丢失，应按每项影响重设，并同步数据库或服务配置。

项目文档和 Git 保存的是操作依据与历史，个人安全副本保存的是真实凭据；两者都需要。运行配置、迁移凭据、root 密码和备份解密密钥的 KeePassXC 条目已保存。服务器加密备份已拉取并完成隔离恢复；加密包仍需每周及重要更新后另存百度网盘，避免 Windows 主机成为唯一副本。
