# OTA 热更新(EAS Update)说明

接入时间:2026-08-29。项目:`262711cc-a1c2-4fd8-9e77-ad482072c6de`

## 能热更什么、不能热更什么

- ✅ **能 OTA(免过审)**:JS/TS 代码、样式、文案、图片等资源改动(如工具 Tab 调整、页面文案、大多数功能迭代)。
- ❌ **仍需重新打包+过审**:新增/升级**原生模块**、改**权限**、改 app.json 里影响原生的配置。
  这类改动会让 `runtimeVersion`(fingerprint 策略,按原生依赖指纹计算)变化,旧构建收不到该更新——这是**保护**,防止把不兼容的 JS 推给旧壳。

## 一次性:先发一个「带 expo-updates」的商店版本

> ⚠️ 接 expo-updates 本身是原生改动,所以**必须先用 EAS 重新打包并提交商店一次**。
> 从这个版本起,用户手机才具备 OTA 能力;之后纯 JS 改动才能免过审热推。

```bash
# 生产构建 + 提交(iOS 走 App Store,安卓走 Play 内测轨)
eas build --profile production --platform all
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

(当前已加的 Tools 工具 Tab 是纯 JS,会随这个版本一起上线。)

## 之后:推送热更新(免过审)

改完 JS,推到对应渠道即可,用户下次冷启动 app 自动生效(checkAutomatically=ON_LOAD):

```bash
# 推给生产用户
eas update --branch production --message "改了什么"

# 先推内部预览(preview 构建)验证
eas update --branch preview --message "灰度验证"
```

- 渠道映射:production 构建订阅 `production` 分支,preview 构建订阅 `preview` 分支(见 eas.json 的 channel)。
- 想回滚:`eas update --branch production --message "rollback"` 重推上一个好版本,或用 `eas update:rollback`。
- 查看已发更新:`eas update:list --branch production`。

## 配置位置

- `app.json` → `expo.updates`(url/enabled/checkAutomatically)+ `expo.runtimeVersion`(policy: fingerprint)
- `eas.json` → 各 profile 的 `channel`
