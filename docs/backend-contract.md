# 客户端账户、订阅与支付对接草案

这是建议的接口合同，不表示以下端点已经存在。收到真实后端文档后应适配现有系统，不能将此草案直接当作线上接口调用。

## 用户流程

在客户端登录或注册 TierFlow → 查看 12.9 元月度套餐、有效期和额度条款 → 客户端内创建订单并展示支付二维码 → 扫码支付 → 后端收到支付机构通知并验证 → 客户端刷新已付款订单与订阅权益 → 获取限定评分用途的授权 → 开始路由。

订阅支付不跳转到 TierFlow 官网购买。若支付渠道要求外部扫码或验证，可由客户端展示平台授权二维码及结果。未收到服务端确认前不能展示支付成功。二维码仅由服务端产生，不由桌面客户端拼接签名或商户凭据。

## 建议接口

统一 HTTPS JSON。鉴权 Token 保存在主进程 safeStorage，Renderer 仅获得账户摘要。以下路径均为待后端确定的建议名称。

| 接口 | 用途 | 返回数据要点 |
| --- | --- | --- |
| `POST /desktop/v1/auth/login` | 登录；支持服务端要求的额外验证状态 | access_token、refresh_token、expires_at 或 challenge |
| `POST /desktop/v1/auth/refresh` | 更新会话 | 新令牌与有效期 |
| `POST /desktop/v1/auth/logout` | 撤销当前设备会话 | 撤销结果 |
| `GET /desktop/v1/account` | 账户摘要 | user_id、display_name、脱敏联系方式 |
| `GET /desktop/v1/plans` | 当前可售套餐 | plan_id、1290 分人民币、计费周期、额度、并发、续费 / 退款规则、条款版本 |
| `GET /desktop/v1/subscription` | 查询真实权益 | status、start_at、end_at、用量 / 剩余额度、并发上限 |
| `POST /desktop/v1/orders` | 创建订单；需 Idempotency-Key | order_id、amount_minor、currency、expires_at、payment_method、qr_content |
| `GET /desktop/v1/orders/{order_id}` | 查询订单 | pending / paid / expired / cancelled / refunded |
| `POST /desktop/v1/tiersense/authorization` | 获取评分专用短期授权 | score_url、scoped_token、expires_at、rate_limits |

账号注册方式（手机号验证码、邮箱或其他身份验证）待产品和现有服务约定。客户端不得以用户公网 IP、设备标识或本地生成字段替代服务端登录鉴权。

## 建议返回结构

```json
{
  "data": {
    "plan_id": "tiersense_personal_monthly",
    "amount_minor": 1290,
    "currency": "CNY",
    "subscription_status": "active",
    "expires_at": "ISO-8601 UTC timestamp"
  },
  "request_id": "server-generated-id"
}
```

统一错误返回 `error.code`、可展示的 `error.message`、`request_id`；限流使用 429 和 Retry-After，过期授权使用 401，订阅无效使用可区分的 403 业务码。

## 实施约束

- 12.9 元是否包含无限调用、按月多少评分次数 / Token、如何定义一个月、是否自动续费尚未决定。上线前由服务端明确，不由客户端猜测。
- 价格、权益、到期时间、订单支付状态均由服务端判定；不能信任本地 UI 状态、系统时间或扫码后的回跳参数。
- 商户 API 密钥、支付签名和退款操作保留在服务端。回调验签、支付金额核对、重复通知幂等是后端责任。
- 账户 Key、评分授权与本地网关 Key 分离。服务端不能索取用户第三方模型渠道密钥来完成订阅。
- 评分 API 在服务端检查订阅与限流；客户端公开源代码或可修改，因此不能靠客户端按钮约束权益。
- 客户端关闭支付界面时停止轮询；打开后可恢复未完成订单，支持超时、取消、已付款后延迟到账等状态。
- 需要验证码、二次验证或条款确认时由用户在明确的界面完成，不模拟授权成功。

当前代码保留账户与订阅 UI，但未实现假登录、假订单或不安全的默认后端地址。待合同确认后增加独立 `AccountService`，通过主进程受限 IPC 将账户与支付状态提供给界面。
