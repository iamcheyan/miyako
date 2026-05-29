#!/bin/bash
# 检查 Ralph 执行进度

echo "=========================================="
echo "  Ralph 进度检查 - NasMusicSync"
echo "=========================================="
echo ""

# 检查 Ralph 是否还在运行
if pgrep -f "ralph.sh" > /dev/null; then
    echo "🔄 状态: Ralph 正在运行中..."
else
    echo "✅ 状态: Ralph 已完成或未运行"
fi
echo ""

# 显示已完成的 stories
echo "📋 Story 完成状态:"
if [ -f prd.json ]; then
    completed=$(jq '[.userStories[] | select(.passes == true)] | length' prd.json)
    total=$(jq '.userStories | length' prd.json)
    echo "   已完成: $completed / $total"
    echo ""
    jq -r '.userStories[] | "\(.id) [\(.passes|if . then "✅" else "⏳" end)] \(.title)"' prd.json
else
    echo "   prd.json 不存在"
fi
echo ""

# 显示最近的 git 提交
echo "📝 最近提交记录:"
if [ -d .git ]; then
    git log --oneline -10 2>/dev/null || echo "   无提交记录"
else
    echo "   不是 git 仓库"
fi
echo ""

# 显示 progress.txt 最后更新
echo "📄 最近进度日志:"
if [ -f progress.txt ]; then
    tail -20 progress.txt
else
    echo "   progress.txt 不存在"
fi
