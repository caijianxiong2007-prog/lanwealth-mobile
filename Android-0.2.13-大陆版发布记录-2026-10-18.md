# 大陆版 Android 0.2.13 发布记录

日期：2026-10-18（北京时间）。Android 0.2.13（21）已完成构建、覆盖升级验收及官网下载发布；不代表已在应用商店上架。

## 目标与边界

- 同步当前 `cn` 分支的 0.2.13 代码，保留包名 `cn.lanwealth.baize` 及原 Android 发布签名，验证旧版覆盖升级后更新官网下载入口。
- 构建代码基线：`971d6c5344078ae2bc3093e76d0abca628e2ae10`；此前线上 APK 为 0.2.9（16）。本轮未修改应用功能代码。
- 不改动已送审的 iOS 构建，不修改生产业务数据，不购买付费构建服务。

## 构建与准备

1. 核对 EAS Android 历史构建、应用配置及原发布签名配置。
2. `npm test`：40/40 通过；`npx tsc --noEmit`：通过。
3. `npx expo export --platform android --output-dir .expo/android-release-export`：成功，1054 模块及 45 项资源完成 Android Hermes 编译。此步骤不等同于 APK 原生编译成功。
4. `npx expo prebuild --platform android --no-install`：成功，生成的 Android 工程未进入 Git；package.json 无变化。
5. EAS 云构建尝试使用原签名配置，远端 versionCode 从 19 递增到 20，但在启动前被免费额度限制阻断；未产生新版 APK。服务端提示额度 2026-11-01 恢复。
6. 在独立的 `.codex/toolchains/android/` 中准备本机工具，不改系统 Java 配置。Temurin JDK 17.0.20.1+1 的 SHA-256 与官方发布记录一致；Android Command-line Tools 19.0 的 SHA-1 与 Google 仓库清单一致。
7. 下载页增加直接 APK 下载和 ZIP 备用，区分桌面更新与手机覆盖安装。iOS 仅陈述 2026-10-18 已提交审核的事实，不宣称已上架。下载版本/链接一致性测试 2/2 通过，已接入发布门槛；完整门槛检查通过。

## 本机构建结果

- 用户已明确授权接受 Google Android SDK 开发工具许可并继续本机构建，无付费或新增云服务。
- SDK Platform 35、Build Tools 35.0.0、Platform Tools、CMake 3.22.1、NDK 27.1.12297006 已准备完成；另安装 Android Emulator 37.2.12 和 Android 15 AOSP ARM64 测试镜像。NDK、模拟器及镜像的校验值均与官方仓库清单一致。
- 工具下载遭遇连接重置后续传完成。EAS 本地流程已取得原发布签名并注入构建号 21；首次流程在 NDK 自动安装阶段中止，保留暂存工程，补齐工具后继续同一签名及构建号的 Gradle Release 构建。
- 手动恢复编译时补齐 EAS_BUILD_WORKINGDIR 环境变量；仅对本次构建禁用已失效的 127.0.0.1:8080 Java 代理，不修改系统网络设置。依赖下载已恢复。
- Gradle Release 原生编译成功，耗时 10 分 42 秒，749 项任务，690 项执行、59 项命中缓存。构建号为 21，未使用调试包替代发布包。
- 包名 `cn.lanwealth.baize`，versionName `0.2.13`，versionCode `21`，minSdk 24，targetSdk 35，保留 arm64-v8a、armeabi-v7a、x86、x86_64 四种架构。
- APK v2 签名验证通过，无 debuggable 标记。与原 0.2.9 发布证书一致，证书 SHA-256：`f3c21bca317af82d94889b11a5d2eaaf4e6221c296e6f9de954313bfb64105d4`。
- APK 未包含构建签名凭据文件；签名材料及原始构建日志仅保存在本机私有暂存目录，不提交 Git。

## 原生验收

2026-10-18 12:22 完成 Android 15 AOSP ARM64 隔离模拟器验收，10 项检查通过：

1. 安装原已发布的 0.2.9（16）。
2. 直接覆盖升级为 0.2.13（21），首次安装时间仍为 12:08:54，更新时间为 12:20:16，无需卸载。
3. 冷启动正常进入未登录页。
4. 未勾选协议时阻止发送验证码，未发送真实短信。
5. 独立演示明确标注本机示例，不冒充真实在线结果。
6. 会议整理：结果展示、复制、重置通过。
7. 资料摘要：结果展示、复制、重置通过。
8. 询价邮件：结果展示、复制、重置通过。
9. 演示账户与 APP 备案号正常显示。
10. 从演示返回登录不生成已认证会话。

## 制品及公开下载校验

- 官网入口：<https://app.lanwealth.cn/download>。
- APK：<https://lanwealth.cn/mobile/baize-android-v0.2.13.apk>，81,749,056 字节；SHA-256：`9eaa773e61c26a0548f26e76a48d6dd741a7f7feac6bf64baac9bfac1edfbbc7`。
- ZIP：<https://lanwealth.cn/mobile/baize-android-v0.2.13.zip>，37,103,812 字节；SHA-256：`e53a1e03a7b534e1448b7e16e0c436514f88b9cdfe376ff15c15c82732fac036`。
- ZIP 仅含对应 APK，解压内容与发布 APK 哈希一致。12:28 完成两项公开文件的完整下载校验，均与本机发布制品一致。
- 使用现有上海 OSS 桶和 `lanwealth.cn` 自定义域名/CDN，不修改 DNS、证书或 CNAME。OSS 默认域名直接下载 APK 返回 ApkDownloadForbidden，故未对外使用受限链接，也未改名规避限制。依据：[阿里云官方说明](https://help.aliyun.com/zh/oss/what-to-do-with-apkdownloadforbidden-reporting-an-error)。

## 网站提交与部署

- `lanwealth-cn` 提交 `691af98`：`fix(cn): publish Android 0.2.13 downloads through verified custom domain`，已推送主仓库 Codeup 的 `origin/main`。
- 修改限于下载页、下载一致性测试及发布前测试注册。窄屏和桌面预览均无横向溢出；下载二维码解析仍指向官网下载页。
- LATEST 上传后下载函数代码快照，核验其中下载页与提交源码字节一致。代码校验值：`17986331312071746133`。
- `cn-app-web` 已发布不可变版本 v4，5%、25%、100% 三轮现有探针通过，stable 全量 v4、无灰度权重，原 v3 保留可回滚。
- 探针包含空请求的预期错误响应，不能据此宣称完成真实付款、短信或在线模型验收。
- 全量切换后再次刷新正式下载页 CDN，任务 `33621100448`；此前 ZIP 刷新任务 `33619387586`、暂存发布目录刷新任务 `33619397213`。
- 18:36 再次验证公开 APK/ZIP 均为 HTTP 200、长度及 MIME 正确；模型列表接口 HTTP 200 且 `ok=true`，未执行付费生成或业务数据写入。
- 浏览器正式下载页显示 0.2.13（21）及正确 APK/ZIP 链接。截图：`/Users/jianxiongcai/.codex/tmp/bayze-cn-android-0.2.13-20261018/android-download-live-20261018.jpg`。
- 收尾检查：本轮 8776 临时预览服务已不在运行，ADB 无连接设备，无本轮构建或验收进程需要继续等待。

## 已知边界与后续工作

- 本轮没有执行真实账号短信登录、在线模型、真实附件/相册、语音、云同步、注销等全流程复测；应安排专用测试账号和真机验收，不能以本机演示替代。
- 仅完成 Android 15 模拟器验证，其他 Android 版本及厂商机型兼容性仍需真机抽测。
- 本次只更新官网下载，不含 Google Play 或国内应用商店提审；Android 需覆盖安装新版本，不具备 OTA 自动更新。
- 依赖维护仍待专项治理：Expo doctor 17/18，react-native-markdown-display 维护状态告警；npm audit 53 项（19 moderate、33 high、1 critical）。未执行破坏性批量升级。critical shell-quote 属 React DevTools 开发依赖链，在生产 source map 中未发现；decode-uri-component、nanoid 等运行依赖告警仍需单独修补及回归。
- 编译中的 Gradle/Kotlin 弃用告警未阻断本次构建，后续结合 SDK 升级治理。

## 本机证据

私有目录：`/Users/jianxiongcai/.codex/tmp/bayze-cn-android-0.2.13-20261018`。

- `release-verification.json`：版本、证书、架构、下载哈希及公开校验结果。
- `android-ui-verification.json`：10 项验收、覆盖安装时间及原生截图路径。
- `native-build.log`、`site-precheck.log`、`site-deploy.log`、`site-release.log`：构建、门槛、暂存及灰度日志。原始构建失败输出可能涉及私有构建参数，不作为公开附件。
