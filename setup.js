#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SRC_DIR = path.join(process.cwd(), "src");
const APP_DIR = path.join(SRC_DIR, "app");
const PAGES_DIR = path.join(SRC_DIR, "pages");
const ENV_PATH = path.join(process.cwd(), ".env");
const SENTRY_DSN_LINE = `NEXT_PUBLIC_SENTRY_DSN='https://examplePublicKey@o0.ingest.sentry.io/0'`;

function dirExists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function writeFileIfNotExists(filePath, content) {
  if (fileExists(filePath)) {
    console.log(`文件已存在，跳过: ${filePath}`);
    return;
  }
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`已创建: ${filePath}`);
}

function appendEnvDSN() {
  let needAppend = true;
  if (fileExists(ENV_PATH)) {
    const envContent = fs.readFileSync(ENV_PATH, "utf8");
    if (envContent.includes("NEXT_PUBLIC_SENTRY_DSN")) {
      needAppend = false;
      console.log(".env 已包含 NEXT_PUBLIC_SENTRY_DSN，跳过追加");
    }
  }
  if (needAppend) {
    fs.appendFileSync(
      ENV_PATH,
      (fileExists(ENV_PATH) ? "\n" : "") + SENTRY_DSN_LINE + "\n",
      "utf8"
    );
    console.log(".env 已追加 SENTRY DSN");
  }
}

// 统一 Sentry 相关文件内容
const INSTRUMENTATION_CLIENT_CONTENT = `import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, // Sentry DSN，建议通过环境变量配置

    // 是否收集用户请求头和 IP，详见官方文档
    sendDefaultPii: true,

    // 采样 0 的会话进行回放 （视频回放）
    replaysSessionSampleRate: 0,
    // 发生错误时 100% 采样回放 （错误捕获）
    replaysOnErrorSampleRate: 1.0,
    // 性能追踪采样率，1.0 表示全部采集 （性能追踪）
    tracesSampleRate: 1.0,

    // 启用 Sentry 日志功能 （日志采集）
    _experiments: { enableLogs: true },

    // 集成浏览器追踪和控制台日志采集 （包裹sentry的logger方法、 以及console.log/warn/error）
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.consoleLoggingIntegration({ levels: ["log", "error", "warn"] })
    ],

    // 允许哪些目标进行 trace 头传播
    tracePropagationTargets: ["localhost"]
});

// 导出路由跳转追踪，仅在启用 tracing 时有效
// 'captureRouterTransitionStart' 需 Sentry SDK 9.12.0 及以上版本
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
`;

const INSTRUMENTATION_CONTENT = `import * as Sentry from "@sentry/nextjs";

export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        await import("./sentry.server.config");
    }

    if (process.env.NEXT_RUNTIME === "edge") {
        await import("./sentry.edge.config");
    }
}

export const onRequestError = Sentry.captureRequestError;
`;

const SENTRY_EDGE_CONFIG_CONTENT = `import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Adds request headers and IP for users, for more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: true,

    // ...

    // Note: if you want to override the automatic release value, do not set a
    // 'release' value here - use the environment variable 'SENTRY_RELEASE', so
    // that it will also get attached to your source maps
});
`;

const SENTRY_SERVER_CONFIG_CONTENT = `import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Adds request headers and IP for users, for more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: true,

    // ...

    // Note: if you want to override the automatic release value, do not set a
    // 'release' value here - use the environment variable 'SENTRY_RELEASE', so
    // that it will also get attached to your source maps
});
`;

function writeSentryFiles() {
  const root = process.cwd();
  writeFileIfNotExists(
    path.join(root, "instrumentation-client.ts"),
    INSTRUMENTATION_CLIENT_CONTENT
  );
  writeFileIfNotExists(
    path.join(root, "instrumentation.ts"),
    INSTRUMENTATION_CONTENT
  );
  writeFileIfNotExists(
    path.join(root, "sentry.edge.config.ts"),
    SENTRY_EDGE_CONFIG_CONTENT
  );
  writeFileIfNotExists(
    path.join(root, "sentry.server.config.ts"),
    SENTRY_SERVER_CONFIG_CONTENT
  );
}

// 检查 @sentry/nextjs 是否已安装，未安装则自动安装
function ensureSentryInstalled() {
  try {
    execSync("pnpm add @sentry/nextjs", { stdio: "inherit" });
    console.log("@sentry/nextjs 安装完成");
  } catch (err) {
    console.error("安装 @sentry/nextjs 失败，请手动安装！");
    process.exit(1);
  }
}

console.log("Sentry 自动接入脚本开始...");
ensureSentryInstalled();
if (!dirExists(SRC_DIR)) {
  console.error("未找到 src 目录，请在项目根目录下运行本脚本。");
  process.exit(1);
}

appendEnvDSN();

const hasAppDir = dirExists(APP_DIR);
const hasPagesDir = dirExists(PAGES_DIR);

if (!hasAppDir && !hasPagesDir) {
  console.error("未检测到 app 或 pages 路由目录，请手动处理。");
  process.exit(1);
}

// 只要有 app 目录就写 global-error.tsx
if (hasAppDir) {
  const globalErrorPath = path.join(APP_DIR, "global-error.tsx");
  const globalErrorContent = `'use client'

import * as Sentry from '@sentry/nextjs'
import NextError from 'next/error'
import { useEffect } from 'react'

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        {/* NextError is the default Next.js error page component. Its type definition requires a statusCode prop. However, since the App Router does not expose status codes for errors, we simply pass 0 to render a generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  )
}
`;
  writeFileIfNotExists(globalErrorPath, globalErrorContent);
}

// 只要有 pages 目录就写 _error.tsx
if (hasPagesDir) {
  const errorPath = path.join(PAGES_DIR, "_error.tsx");
  const errorContent = `import * as Sentry from "@sentry/nextjs";
import type { NextPage } from "next";
import type { ErrorProps } from "next/error";
import Error from "next/error";

const CustomErrorComponent: NextPage<ErrorProps> = (props) => {
  return <Error statusCode={props.statusCode} />;
};

CustomErrorComponent.getInitialProps = async (contextData) => {
  await Sentry.captureUnderscoreErrorException(contextData);
  return Error.getInitialProps(contextData);
};

export default CustomErrorComponent;
`;
  writeFileIfNotExists(errorPath, errorContent);
}

// Sentry 相关配置文件始终写入
writeSentryFiles();

console.log("\nSentry 基本接入已完成！请根据文档继续补充剩余配置。");
