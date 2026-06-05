# Bayze AI — Google Play 上架逐项填报清单

> 账号:**个人 Individual**(对齐苹果)。⚠️ 个人账号上 Production 前需 **封闭测试 ≥20 人 × 14 天**。
> 包名:`com.lanwealth.bayze` · 隐私政策:`https://app.lanwealth.com/privacy` · 支持邮箱:`support@lanwealth.com`

---

## 0. 创建应用
- [ ] Play Console → **Create app**
- [ ] App name:`Bayze AI`(≤30 字符)
- [ ] Default language:English (United States) 或 简体中文(看主市场)
- [ ] App or game:**App**
- [ ] Free or paid:**Free**
- [ ] 勾选两个声明(开发者计划政策、美国出口法)

## 1. App access(登录访问)★ 有福利
- [ ] 选 **All functionality is available without special access**
- [ ] 理由:**有游客模式,无需登录即可使用聊天**(和 iOS 5.1.1 整改同理,省去提供测试账号)
- [ ]（如审核员仍要账号,备用:`apple-review@lanwealth.com` / `Bayze-Review-2026`)

## 2. Ads(广告)
- [ ] **No**,本应用不含广告

## 3. Content rating(内容分级)
- [ ] 填问卷:类别选 **Utility/Productivity/Communication**
- [ ] 如实回答:用户可生成/查看开放文本(AI 聊天)→ 可能含不受限文本
- [ ] 无暴力/色情/赌博/毒品等内容
- [ ] 提交后自动得 IARC 分级

## 4. Target audience and content(目标受众)
- [ ] 年龄段:**18 及以上**(对齐隐私政策 §9 Minors)
- [ ] 不面向儿童 → 避开 Families 政策
- [ ] Store presence 给儿童:**No**

## 5. Data safety(数据安全)— 按隐私政策口径如实填
- [ ] 是否收集/共享用户数据:**是**
- [ ] 传输加密:**是(HTTPS/TLS)**
- [ ] 提供数据删除方式:**是** → 删除请求 URL 填 `https://app.lanwealth.com/privacy`(或专门删除页);途径:邮件 support@lanwealth.com,删号 30 天内清除
- 收集项(均「与身份关联、非用于追踪」):
  - [ ] **Personal info → Email**(注册邮箱;游客不收集)— 用途:账户管理、App 功能
  - [ ] **Personal info → Name**(Google 登录公开资料,若启用)— App 功能
  - [ ] **App activity → 其他用户生成内容 / 应用内操作**(聊天消息发往模型处理;请求体不留存,仅留用量元数据)— App 功能
  - [ ] **App info & performance**(用量日志:模型/token/延迟/状态码)— App 功能、分析
  - [ ] **Device or other IDs / IP**(登录时间戳+IP,安全审计)— App 功能、安全
  - [ ]（如 Android 端显示充值入口)**Financial info → 购买记录** — App 功能
- 数据共享:
  - [ ] 聊天内容**转发给上游 AI 模型商**处理(声明为「与第三方共享/服务商处理」)

## 6. Store listing(商品详情)
- [ ] App name:`Bayze AI`
- [ ] Short description(≤80):`Chat with top AI models — GPT, Claude, Gemini & more — in one app.`
- [ ] Full description(≤4000):见下方「描述文案」
- [ ] App icon:**512×512** PNG(用 `assets/icon.png` 导 512)
- [ ] Feature graphic:**1024×500**(需新做一张)
- [ ] Phone screenshots:**2–8 张**(16:9 或 9:16;iOS `store-screenshots` 改尺寸复用)
- [ ] 分类:Category = **Productivity**(对齐 iOS 效率/工具)
- [ ] 标签 Tags、联系邮箱 `support@lanwealth.com`、网站 `https://app.lanwealth.com`

## 7. App content 其它声明
- [ ] Privacy policy URL:`https://app.lanwealth.com/privacy`
- [ ] Government app:**No**
- [ ] Financial features:无信贷/投资等 → 据实(一般 No)
- [ ] Health:**No** · COVID:**No**
- [ ] Data deletion(账号删除):提供 URL（同 §5）

## 8. 定价与分发(Pricing & distribution)
- [ ] Free
- [ ] 选择分发国家/地区(对齐 iOS:174 国;大陆是否上 Google Play=否,大陆无 GP)
- [ ] 含广告:No · 内容指南/美国出口法:勾选

## 9. API access(service account,用于 eas submit)
- [ ] Setup → API access → 创建/连接 service account(跳 Google Cloud)
- [ ] 在 Play Console 给它授权:**Admin** 或 Release manager(对本 App)
- [ ] Google Cloud 给它建 **JSON 密钥** → 下载
- [ ] 重命名为 `google-play-key.json` 放 `lanwealth-mobile` 根目录(已 gitignore)

## 10. 上传与发布
- [ ] 先发 **Internal testing**(秒上、无审核):`eas submit -p android --profile production --latest`
- [ ] 自己装 .aab 测一遍:首启进游客聊天、能发消息、付费模型灰显带锁
- [ ] 个人账号路径:建 **Closed testing**,拉 ≥20 测试者,跑满 **14 天**
- [ ] 满足后申请 Production access → 提交审核 → roll out

---

## 描述文案(可直接粘贴)

**Short description:**
Chat with top AI models — GPT, Claude, Gemini & more — in one app.

**Full description:**
Bayze AI is a simple, focused AI chat app for everyday work, writing, coding, learning, and research.

Start chatting instantly — no account required. Try it as a guest, and sign in only when you want to save your conversations across devices or use premium models.

Key features:
- Chat with multiple leading AI models in one place
- Free models available without an account
- Conversation history kept on your device
- Choose the response language
- Optional custom OpenAI-compatible API endpoint (bring your own key)
- Clean dark interface built for focus

Sign in (optional) to sync chats across devices, unlock premium models, and manage credits.

---

## ⚠️ 注意事项
- **外部充值入口**:Android 端目前显示「充值」跳网页(iOS 已隐藏)。Google Play 对「应用内数字商品」也有支付政策,稳妥起见首发可考虑像 iOS 一样在安卓也隐藏外部充值链接,或用 Google Play Billing。**上架前再定**,不阻塞建 App。
- **隐私政策**已完整(10 节),直接填 URL 即可,无需改。
- 账号删除:Google 要求可删号;现有途径=邮件 support@lanwealth.com(30 天清除),建议日后做个网页删除表单更稳。
