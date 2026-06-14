# iOS Build 16 测试上传记录

日期: 2026-06-13

## 本次目的

将 iOS 版 Bayze 重新构建并上传到 App Store Connect,用于 TestFlight / 苹果侧测试。重点验证移动端对话框的附件能力:

- 相册图片导入
- 相机拍照导入
- 文本/代码文件导入
- PDF / Word(.docx) / Excel(.xlsx/.xls) 文档提取后进入对话

## 本次修改范围

- `app/(tabs)/index.tsx`
  - 图片附件不再把本地 `file://` URI 直接发送给后端,而是确保转为 `data:image/...;base64,...`。
  - iOS 相册入口显式请求相册权限。
  - 文件选择器从窄 MIME 过滤改为先允许选择文件,再本地校验支持格式,避免 iOS 文件列表为空。
  - 文本/代码文件本地读取。
  - PDF / docx / xlsx / xls 走 `https://app.lanwealth.com/api/extract` 提取文本后进入对话。

- `lib/api.ts`
  - 导出 `APP_URL`,供移动端文件解析复用统一后端地址。

## 本地验证

```bash
npm exec tsc -- --noEmit
```

结果: 通过。

## EAS Build

命令:

```bash
eas build --platform ios --profile production --non-interactive --wait
```

结果:

- App Version: `1.1.0`
- Build number: `16`
- EAS Build ID: `b69dd2b0-fcff-4b07-9b12-c47a819fa563`
- IPA: `https://expo.dev/artifacts/eas/50KU7gYhgeV1kAJnw1M6IXPjHO-QjNTQQIhsXmBUahg.ipa`
- Build page: `https://expo.dev/accounts/caijianxiong/projects/lanwealth-mobile/builds/b69dd2b0-fcff-4b07-9b12-c47a819fa563`

## App Store Connect 上传

命令:

```bash
eas submit --platform ios --profile production --latest --non-interactive
```

结果:

- Submission ID: `4fa06dc7-fdc3-46f0-a024-b57680806025`
- Submission page: `https://expo.dev/accounts/caijianxiong/projects/lanwealth-mobile/submissions/4fa06dc7-fdc3-46f0-a024-b57680806025`
- App Store Connect App ID: `6774803277`
- TestFlight 页面: `https://appstoreconnect.apple.com/apps/6774803277/testflight/ios`

状态: 已成功上传到 App Store Connect,等待 Apple processing 完成。

## 建议测试清单

- 从相册选择图片后发送,确认对话气泡显示缩略图,模型能识别图片内容。
- 用相机拍照后发送,确认图片能进入对话。
- 选择 `.txt/.md/.json/.csv/.js/.ts/.py` 等文本/代码文件,确认内容能进入对话。
- 选择 `.pdf/.docx/.xlsx` 文档,确认能提取文本并进入对话。
- 在 iOS 未登录/游客状态下测试附件入口是否给出合理提示。
