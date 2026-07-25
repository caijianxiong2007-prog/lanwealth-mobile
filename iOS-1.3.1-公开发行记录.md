# iOS 1.3.1 公开发行记录(2026-07-24)

## 背景
- App Store 公开版停在 **1.2.0**(2026-07-05 上线);TestFlight 已迭代至 1.3.0(企业能力批,07-23 真机验收通过)。
- 公众号推广已启动,商店版与宣传口径(产品说明 V7)脱节 → 决定把 **1.3.1**(=1.3.0 全部内容 + 助手消息 Markdown 渲染/表格修复,commit `5d40726`)作为公开版推送。
- 策略:**一个 build 走完 TestFlight 冒烟 → App Store 提审**,不发 1.3.0 再补审。

## 构建与提交
- EAS Build(production,appVersionSource=remote,buildNumber 自增):
  - 构建页:https://expo.dev/accounts/caijianxiong/projects/lanwealth-mobile/builds/95b5bed0-1d5d-4ba5-a55a-b193086143ec
  - 启动命令:`EAS_SKIP_AUTO_FINGERPRINT=1 npx eas build --platform ios --profile production --non-interactive --no-wait`
- TestFlight 提交:构建完成后 `npx eas submit --platform ios --profile production --latest --non-interactive`(自动执行,结果见下方「结果」节)。
- App Store 提审(人工,App Store Connect):新建版本 1.3.1 → 选中该 build → 贴发布说明 → 提交审核。
  - ASC App ID:6774803277;TestFlight:https://appstoreconnect.apple.com/apps/6774803277/testflight/ios

## 发布说明(App Store「此版本的新增内容」)

**中文:**
> - 消息全面支持 Markdown 排版:标题、加粗、列表、代码块;表格清晰呈现,宽表格可横向滑动
> - 企业工作台升级:顶部显示当前企业,多企业一键切换
> - 对话工具条优化:模型选择、回复语言、个人/公司模式切换更顺手
> - 若干稳定性修复与细节打磨

**English:**
> - Full Markdown rendering in replies — headings, lists, code blocks, and tables (swipe wide tables horizontally)
> - Organization workspace: see your current organization on top and switch in one tap
> - Improved chat toolbar: model picker, reply language, personal/company mode
> - Stability fixes and polish

## 提审前检查清单(1.2.0 过审 ≠ 1.3.x 自动安全)
- [ ] **演示账号有效**:App Review 信息里的账号能登录,且能看到一个有数据的**演示企业**(勿用中崛真实数据);游客模式可用。
- [ ] **充值入口红线(3.1.1)**:真机检查 App 内(工具条/设置/新入口)无任何指向网页充值、套餐购买的链接或文案;沿用 1.0 提审策略「不展示外部充值入口」。
- [ ] TestFlight 冒烟:表格消息渲染(让模型出一张宽表,横向滑动)、企业下拉切换、流式输出光标、长按选中复制。
- [ ] 商店截图仍是旧版界面,可选更新(不阻塞提审)。
- [ ] 发布方式建议:**分阶段发布(Phased Release)**,出问题可暂停。

## 结果
- Build:**1.3.1 (30)**,FINISHED 2026-07-25 03:17 UTC(排队+编译约 5 分钟)
- TestFlight 提交:✅ 已上传 App Store Connect,Submission `da3f7d0f-20b4-4f63-8ca1-c7a107a5580f`(Apple processing 5-10 分钟后现身 TestFlight)
- 提审:✅ **2026-07-25 上午已提交审核**(状态「正在等待审核」,Apple 称最多 48h,邮件通知)。要点:
  - 发布方式=**手动发布**(过审后不点「发布」不会上线,留真机验证安全阀);
  - 审核策略沿用 1.2.0 过审口径:「需要登录」未勾选,靠**游客模式**(备注含 Continue as guest 指引),无演示账号;
  - 备注追加 ORGANIZATION FEATURES 说明(企业工作台仅企业用户可见,其余更新项游客全可测)——预防「找不到该功能」的元数据质询;
  - 充值红线复核:App 内两处 billing 链接均被 `Platform.OS !== 'ios'` 门控,iOS 无购买入口(与 1.2.0 一致);
  - 本地化仅简体中文(主要),无需补英文 What's New。
- ⚠️ 另:Apple 通知 **2026-09-07 前**须在「App 信息」回答社交媒体功能年龄分级新问题(与本次提审无关,勿忘)。
- 过审后操作:真机装 TestFlight 1.3.1(30) 冒烟(宽表格横滑/企业下拉/长按复制)→ 无问题则在 ASC 点「发布此版本」,建议选**分阶段发布**。
