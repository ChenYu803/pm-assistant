# 待核对恢复与 24 小时免单（v1.44 #10）

## 持久状态与处理方式

conversation_credit_calls 的 reserved/pending 行就是任务，pending_since 以 UTC 记录首次进入待核对的时间。恢复进程不依赖网页、Next.js 内存计时器或供应商事后查询。每次从数据库分批读取，每笔在账号锁内与计量、停止、正文提交串行处理；失败回滚，继续处理后续行，下轮重试。多进程重复扫描安全，settled/released 不再变动。无新增表或迁移。

pending 满 24 小时仍未结算时，按原分摊释放该笔全部预留，consumed=0、reason=pending_expired；模型标记网站承担，未知成本保留 NULL。期限判断也位于正常结算事务内，证据与到期竞争不会让超期调用重新扣费。个人中心、工作台和后台读取相同持久事实。恢复每分钟执行，健康调度下在期限后的下一轮释放；不是网页内精确到秒的倒计时。

可靠证据仅来自已接入的供应商响应及其持久计量。缺失 usage 不用文字长度或估计 token 补扣；官方供应商未有经验证的逐笔事后查询接口，任务不发送猜测的查询请求。可靠用量和原请求适用价格均可核实才结算；预算超界或价格未核实继续待核对，24 小时收口。晚到证据只补网站成本，已故障免单不能再冻结。

reserved 若供应商已结束则补做结算；running/processing 超过持久 deadline_at 表示进程/处理未能完成，未主动停止者按网站中断免单，已登记停止者保留停止事实并按可靠用量或进入待核对处理。生成正文的既有重启清理仍由网站启动检查承担，本任务只收口计量与账务。

## 生产启用（交给 #14 核验）

本次只交付文件，尚未操作目标机。按生产部署纪律，在目标 Ubuntu 主机保存当前可用发行版、运行配置及数据库安全副本并验证可读取后，部署包含本票的已提交代码。应用和任务均用 /srv/ideastage/current，Node 24 位于 /usr/bin/node，安装包含 tsx 的项目依赖（沿用生产检查工具要求）。确认 runtime.env 指向目标应用数据库、NODE_ENV=production，应用账号具备账本所需 DML 权限；任务无需 MySQL 维护账号或新增密钥。

在目标机 SSH 终端按以下命令安装并启用，每一步检查退出状态。它们只创建或替换两个 systemd 单元，启用定时调度；首次手动执行会实际处理目标库中可恢复的冻结记录。

```bash
sudo install -m 0644 /srv/ideastage/current/deploy/ubuntu/ideastage-usage-recovery.service /etc/systemd/system/
sudo install -m 0644 /srv/ideastage/current/deploy/ubuntu/ideastage-usage-recovery.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start ideastage-usage-recovery.service
sudo systemctl enable --now ideastage-usage-recovery.timer
sudo systemctl list-timers ideastage-usage-recovery.timer
sudo systemctl show ideastage-usage-recovery.service -p Result -p ExecMainStatus
sudo systemctl status ideastage-usage-recovery.timer
sudo journalctl -u ideastage-usage-recovery.service -n 30 --no-pager
```

成功日志包含 scanned/failed 计数且 failed=0；service 的 Result 应为 success、ExecMainStatus 为 0。oneshot 执行后 inactive (dead) 正常，timer 应 active (waiting)，须确认下一次执行时间与重启后调度。非零退出、时钟失步、权限/数据库失败必须排查，不以无输出当成功。发布闸同时核对部署提交、依赖、单元路径、运行账号、配置文件权限、系统 UTC 时钟同步以及真实运行日志，不能只检查网站进程启动。

手动恢复可在发行目录执行 npm run credits:recover -- --env /etc/ideastage/runtime.env；指定文件时不读取 .env.local。生产没有时间推进参数或用量注入 HTTP 接口。测试时间沿用既有邮件/时间替身，须同时满足 development、随机隔离库与账号、本机替身和口令；生产配置即使误带替身变量也拒绝运行。

暂停调度可执行 sudo systemctl disable --now ideastage-usage-recovery.timer，已提交账单不回滚；保留持久任务后可安全重启任务。停用期间未结算额度仍冻结，不应长时间停用。服务配置与依赖故障修复后手动 start，再检查 timer 下一轮。

## 证据边界

隔离专项入口为 npm run verify:v144-pending-usage。正式应用 HTTP 制造缺用量、读取个人与后台状态；生命周期补充用例沿用 #09 的计量公开接口构造同一请求的迟到证据。时间只由本轮随机隔离环境的认证替身推进，独立 CLI 进程处理账本。它不证明供应商支持事后查询，也不替代目标机 timer 与真实配置验收。
