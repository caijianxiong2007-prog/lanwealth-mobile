# Bayze AI iOS App Store 提审资料

## 当前状态

- App Store 名称：Bayze AI
- Bundle ID：com.lanwealth.bayze
- SKU：bayze-ios-001
- 版本号：1.0.0
- Build Number：1
- iOS 首次审核策略：不展示外部充值入口，不引导网页购买 credits。

## 商品页文案

### 推广文本

Bayze AI Chat helps you access multiple leading AI models in one simple mobile chat experience.

### 描述

Bayze AI Chat is a simple and focused AI chat app for everyday work, writing, coding, learning, and research.

Chat with multiple AI models, keep your conversations on your device, choose response languages, and optionally connect your own OpenAI-compatible API endpoint.

Key features:
- Fast AI chat experience
- Multiple model options
- Conversation history on device
- Response language selection
- Optional custom API endpoint
- Clean dark interface for focused work

### 关键词

AI,chatbot,assistant,writing,coding,productivity,Bayze

### 支持 URL

https://app.lanwealth.com

### 营销 URL

https://app.lanwealth.com/download

### 版权

2026 LanWealth

### 分类建议

- 主分类：效率
- 副分类：工具

## 审核信息

### 联系信息

- 姓名：Jianxiong Cai
- 电话：填写你的真实手机号
- 邮箱：填写你的 Apple Developer / 支持邮箱

### 审核备注

（针对上次 Guideline 5.1.1(v) 被拒的整改说明——可直接粘贴到 Resolution Center 回复 / App Review Notes）

Bayze AI is an AI chat application.

In response to the previous rejection under Guideline 5.1.1(v): the app NO LONGER requires registration to use the AI chat. On launch the app opens directly into the chat as a guest (a Supabase anonymous session created automatically — no personal information requested), and a guest is given free trial credits so the chat is fully usable without any account. Registration / sign-in is now optional and only offered for account-based features (syncing chat history across devices and topping up credits).

To verify: just launch the app and send a message in the chat — no login is required. (If you reach the sign-in screen, tap "Continue as guest".)

A test account is also available if you prefer to review the signed-in experience (see below).

For the initial iOS release, the app does not provide external payment links or in-app credit purchases. Account-based actions (top-up) are not shown on iOS.

### 测试账号

专门给 Apple 审核的测试账号（已创建并充值 $10 credits，已验证可登录）：

- Email：apple-review@lanwealth.com
- Password：Bayze-Review-2026

邮箱已由管理员确认，可直接登录。审核通过后可改密码或禁用此账号。

## App 隐私问卷建议

以下按当前移动端功能保守填写，最终仍以你的实际后端记录为准。

### 联系信息

如果登录使用 email：
- Email Address：收集
- 是否与用户身份关联：是
- 用途：App Functionality, Account Management

### 用户内容

聊天消息会发送到服务端模型接口处理：
- Other User Content：收集
- 是否与用户身份关联：是
- 用途：App Functionality
- 是否用于追踪：否

### 使用数据

如果后端记录 usage logs、模型、token、费用、时间：
- Product Interaction：收集
- 是否与用户身份关联：是
- 用途：App Functionality, Analytics
- 是否用于追踪：否

### 诊断

如果没有接入 Sentry/Firebase Crashlytics 等崩溃分析，可先不选。若后续接入，需要补充：
- Crash Data
- Performance Data

### 敏感信息

不要选择，除非实际收集身份证、财务账户、健康、精确位置等。

### 位置

当前 App 不需要位置权限，不选择。

### 联系人、照片、相机

当前 iOS 首发版不需要这些权限，不选择。

## 年龄分级建议

按问卷如实填写。AI 聊天可能产生开放文本内容，建议不要过低估计风险。若被问及是否包含无限制网页访问、用户生成内容、成人内容等，按实际功能保守回答。

## 截图计划

当前还没有 iOS 真机/模拟器截图，可以等 iOS build 跑起来后补。

App Store 当前要求 iPhone 6.5 英寸截图，尺寸可用：
- 1242 x 2688
- 1284 x 2778
- 2688 x 1242
- 2778 x 1284

建议先准备 3 张竖屏截图：

1. 登录页：展示 Bayze 品牌和登录入口。
2. 空聊天页：展示模型选择、语言选择和欢迎界面。
3. 聊天结果页：展示一段简短问答，例如“Summarize the benefits of daily planning”。

截图里不要展示充值、账单、外部购买入口。

## 上传 iOS Build 前检查

- Bundle ID 是 com.lanwealth.bayze
- App Store Connect 名称是 Bayze AI
- iOS App 内不显示外部充值入口
- iOS App 内不显示外部下载/桌面端跳转入口
- App 可使用测试账号登录
- 测试账号有可用 credits
- `npx tsc --noEmit` 通过
- EAS iOS production build 成功

## 后续可选改进

- 若要在 iOS 内销售 credits，使用 Apple In-App Purchase 的 consumable 产品。
- 若要支持 Google 登录，需评估是否也要提供 Sign in with Apple。
- 若要允许用户在 App 内创建账号，需提供账号删除能力或明确的账号删除流程。
