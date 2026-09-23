# 电子书库 Android 应用

## 构建完成 ✅

APK 文件已生成：`/vol1/1000/docker/ebook-reader/android-app/ebook-reader.apk`

## 应用信息

- **应用名称**：电子书库
- **包名**：com.ebookreader.app
- **目标 SDK**：Android 14 (API 34)
- **最低支持**：Android 5.0 (API 21)
- **应用大小**：21 KB

## 功能说明

这是一个 WebView 包装应用，打开后会自动连接到你的 NAS 电子书阅读器服务：
- 访问地址：`http://zsl86.cn:8374`
- 支持所有电子书格式（EPUB、PDF、TXT、MOBI 等）
- 支持上传、分类浏览、阅读进度记录
- 全屏显示，无浏览器界面

## 安装方法

1. 将 `ebook-reader.apk` 文件传输到安卓手机
2. 在手机上打开文件（需要允许"未知来源"安装）
3. 安装完成后，桌面会出现"电子书库"图标
4. 点击图标即可使用

## 注意事项

- 应用需要网络连接才能访问 NAS 上的书库
- 使用 debug 签名，仅供个人使用
- 如需发布到应用商店，需要重新签名

## 构建工具

使用 Android SDK 手动构建：
- aapt2：编译资源文件
- javac：编译 Java 代码
- d8：转换为 DEX 格式
- zipalign：APK 对齐优化
- apksigner：APK 签名
