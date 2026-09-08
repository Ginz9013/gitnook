#!/usr/bin/env node
// 薄殼。解析、渲染與 exit code 全在 src/cli/run.ts，真實 process 的接線在
// processIo() —— 兩者都有測試覆蓋，所以這裡刻意沒有任何可以出錯的邏輯。
//
// 契約：票 11 的打包需產出 dist/cli/run.js，匯出 run 與 processIo。
import { processIo, run } from '../dist/cli/run.js';

// studio 是唯一長駐的指令。Ctrl-C 要讓它把 server 關乾淨，而不是被砍斷。
const stopping = new AbortController();
process.on('SIGINT', () => stopping.abort());
process.on('SIGTERM', () => stopping.abort());

// 用 exitCode 而非 exit()：讓已排入佇列的 stdout 寫完再結束。
process.exitCode = await run(process.argv.slice(2), processIo(stopping.signal));
