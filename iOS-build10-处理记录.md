# iOS build 10 处理记录

记录时间: 2026-06-06
项目: Bayze AI / LanWealth Mobile
App Store Connect App ID: 6774803277
Bundle ID: com.lanwealth.bayze

## 背景

Apple 对 build 7 的审核回复仍显示审核对象为 `1.0 (6)`。原因是 build 7 和 build 8 虽然在 EAS 上触发过构建,但都因 Xcode 原生编译错误失败,没有成功进入 App Store Connect。

之后 build 9 使用 Xcode 16.4 成功生成 IPA 并上传,但 Apple 二进制处理邮件提示:

- ITMS-90725: SDK version issue
- build 9 使用 iOS 18.5 SDK
- 当前要求使用 iOS 26 SDK 或更高,也就是 Xcode 26 或更高

因此 build 9 不能用于提交审核,必须重新用 Xcode 26 / iOS 26 SDK 构建。

## 本次处理

### 1. 构建环境修正

将 `eas.json` 的 iOS production 构建镜像改为:

```json
"image": "macos-sequoia-15.6-xcode-26.2"
```

目的:

- 满足 Apple ITMS-90725 对 Xcode 26 / iOS 26 SDK 的要求
- 避免继续使用 Xcode 16.4 生成不合规二进制

### 2. Xcode 26 原生编译修复

build 7 / build 8 在 Xcode 26 环境下失败,错误摘要包含:

```text
fmt::basic_format_string ... is not a constant expression
```

新增本地 Expo config plugin:

```text
plugins/with-fmt-cxx17.js
```

并在 `app.json` 中启用:

```json
"./plugins/with-fmt-cxx17"
```

插件作用:

- 在 EAS prebuild 生成 iOS Podfile 后,自动为 `fmt` pod 设置:

```ruby
CLANG_CXX_LANGUAGE_STANDARD = 'c++17'
```

- 只作用于 `fmt` target,不全局改 React Native 的 C++ 设置
- 解决 Xcode 26 下 React Native vendored `fmt` 的 C++ consteval 编译问题

### 3. 审核回复文件更新

删除 build 9 回复稿,新增 build 10 回复稿:

```text
Apple-Review-Reply-build10.txt
```

该文件包含:

- App Review Notes
- Resolution Center Reply
- Guideline 4 修复说明
- Guideline 2.1(b) 五个问题逐条回答
- 中文操作参考

重点口径:

- build 10 使用 Xcode 26 / iOS 26 SDK
- 登录、注册、找回密码均为 App 内原生页面
- 提供 App 内删除账号
- 账号可选,游客可直接聊天
- iOS App 内无购买、无订阅、无 credits 购买、无定价页、无外部购买链接或 CTA

## 验证结果

本地检查:

```bash
npx expo config --type public
npx tsc --noEmit
```

结果:

- Expo config 解析通过
- TypeScript 检查通过

EAS build:

```bash
eas build --platform ios --profile production --non-interactive --wait
```

结果:

- build number: 10
- EAS build ID: 0c0449a2-6126-45b5-9446-777aa5b9392e
- status: FINISHED
- commit: 6868df70e29fdc15c5c99621fa1335dba05fe94f
- IPA: https://expo.dev/artifacts/eas/2u4LEE4Fgz1EPvczFx2JLo.ipa

EAS submit:

```bash
eas submit --platform ios --profile production --latest --non-interactive
```

结果:

- build 10 已成功上传到 App Store Connect
- Apple 正在处理二进制
- 处理完成后可在 App Store Connect 中关联 `1.0.0 (10)`

## Git 提交记录

相关提交:

```text
6868df7 fix(ios): build with Xcode 26 SDK
dc31266 docs(ios): finalize build10 review reply
```

源码已推送到 GitHub:

```text
origin/main
```

## 下一步

1. 等 App Store Connect 完成 build 10 processing。
2. 在 iOS 1.0 版本页面选择 build `1.0.0 (10)`。
3. 在 App Review Notes 粘贴 `Apple-Review-Reply-build10.txt` 中的 App Review Notes 段落。
4. 重新提交审核。
5. 在 Resolution Center 点继续编辑 6 月 4 日草稿,用 `Apple-Review-Reply-build10.txt` 中的 Resolution Center Reply 替换旧 build 6 回复。

## 注意

不要再使用 build 9:

- build 9 虽然上传成功,但使用 iOS 18.5 SDK
- Apple 已邮件通知 ITMS-90725
- build 9 不符合当前上传/分发要求

不要在回复中继续使用以下旧口径:

- build 6
- syncing chat history across devices
- premium models
- topping up credits
- premium models are locked

这些旧说法会增加 Guideline 2.1(b) 被继续追问的风险。
