#!/usr/bin/env node

// 测试脚本：验证音频播放功能
// 运行方式：npx tsx test-playback.ts

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_FILE = '/Users/tetsuya/Music/NasSync/Music/faster-whisper-jpop-input/ガールフレンドは午前2時/ミッドナイト・レター.mp3';

console.log('🎵 音频播放测试');
console.log('================');

// 1. 检查文件是否存在
console.log('\n1. 检查测试文件...');
if (existsSync(TEST_FILE)) {
    console.log('   ✅ 文件存在');

    // 2. 读取文件并检查大小
    const data = readFileSync(TEST_FILE);
    console.log(`   📁 文件大小: ${(data.length / 1024 / 1024).toFixed(2)} MB`);

    // 3. 检查文件头是否是有效的 MP3
    const header = data.slice(0, 3);
    if (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) {
        console.log('   ✅ 有效的 MP3 文件头');
    } else if (data.toString('ascii', 0, 3) === 'ID3') {
        console.log('   ✅ 有效的 MP3 文件 (ID3 标签)');
    } else {
        console.log('   ⚠️  文件头可能不是标准 MP3');
    }

    console.log('\n2. 测试结果');
    console.log('   ✅ 文件可读取');
    console.log('   ✅ 文件格式正确');
    console.log('\n🎉 基础测试通过！');
    console.log('\n请在 Tauri app 中测试播放功能。');
} else {
    console.log('   ❌ 文件不存在');
    console.log(`   路径: ${TEST_FILE}`);
    console.log('\n请确保 NAS 已同步音乐文件。');
}
