/**
 * Seq 結構化日誌 wrapper（SDK 直推 CLEF）
 *
 * - 若未設 `SEQ_INGESTION_URL`，僅走原生 console（本地開發、CI 單測）。
 * - 若已設，會建立 seq-logging client 並「同時」monkey-patch console.*，
 *   讓既有的 `console.log/error/warn/info` 呼叫自動送進 Seq，不必改每一行。
 * - 另外 export 了 `logger.info/warn/error` 的 message template 介面，
 *   新程式碼建議用這個寫法以取得可 filter 的 properties（參見 Coolify-Docker-Compose-Spec-v1.1）。
 *
 * 此模組必須在 server.js 最上方 require，越早 patch 越好。
 */
const config = require('./index');

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

let seqLogger = null;

if (config.seq.ingestionUrl) {
  try {
    const { Logger } = require('seq-logging');
    seqLogger = new Logger({
      serverUrl: config.seq.ingestionUrl,
      apiKey: config.seq.apiKey || undefined,
      onError: (err) => {
        // 避免走被 patch 過的 console，防止無窮遞迴
        process.stderr.write(`[Seq] ${err && err.message ? err.message : err}\n`);
      },
    });
  } catch (err) {
    process.stderr.write(`[Seq] init failed: ${err.message}\n`);
  }
}

const BASE_PROPS = () => ({
  App: config.seq.appName,
  Env: config.nodeEnv,
});

function emitToSeq(level, messageTemplate, properties, exception) {
  if (!seqLogger) return;
  try {
    seqLogger.emit({
      timestamp: new Date(),
      level,
      messageTemplate,
      properties: { ...BASE_PROPS(), ...(properties || {}) },
      exception: exception || undefined,
    });
  } catch (err) {
    process.stderr.write(`[Seq] emit failed: ${err.message}\n`);
  }
}

function argsToCleffEvent(args) {
  const parts = [];
  let exception;
  for (const a of args) {
    if (a instanceof Error) {
      exception = a.stack || a.message;
      parts.push(a.message);
    } else if (typeof a === 'string') {
      parts.push(a);
    } else if (a === null || a === undefined) {
      parts.push(String(a));
    } else {
      try {
        parts.push(JSON.stringify(a));
      } catch {
        parts.push(String(a));
      }
    }
  }
  return { message: parts.join(' '), exception };
}

if (seqLogger) {
  const consoleLevelMap = [
    ['log', 'Information'],
    ['info', 'Information'],
    ['warn', 'Warning'],
    ['error', 'Error'],
    ['debug', 'Debug'],
  ];
  for (const [method, level] of consoleLevelMap) {
    console[method] = (...args) => {
      originalConsole[method](...args);
      const { message, exception } = argsToCleffEvent(args);
      emitToSeq(level, message, null, exception);
    };
  }
}

function renderForConsole(template, props) {
  if (!props) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (
    props[k] !== undefined ? String(props[k]) : `{${k}}`
  ));
}

function makeLevelFn(level, consoleMethod) {
  return (messageTemplate, properties, exception) => {
    originalConsole[consoleMethod](renderForConsole(messageTemplate, properties));
    const exceptionText = exception instanceof Error
      ? (exception.stack || exception.message)
      : exception;
    emitToSeq(level, messageTemplate, properties, exceptionText);
  };
}

const logger = {
  debug: makeLevelFn('Debug', 'debug'),
  info: makeLevelFn('Information', 'log'),
  warn: makeLevelFn('Warning', 'warn'),
  error: makeLevelFn('Error', 'error'),
  isSeqEnabled: !!seqLogger,
  async close() {
    if (!seqLogger) return;
    try {
      await seqLogger.close();
    } catch {
      /* ignore */
    }
  },
  async flush() {
    if (!seqLogger) return;
    try {
      await seqLogger.flush();
    } catch {
      /* ignore */
    }
  },
};

module.exports = logger;
