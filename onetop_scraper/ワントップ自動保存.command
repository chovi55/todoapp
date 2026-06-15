#!/bin/bash

# ワントップ 自動保存ツール
# ダブルクリックで実行してください

echo "=============================="
echo "  ワントップ 自動保存ツール"
echo "=============================="
echo ""

# Python3チェック
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3がインストールされていません"
    echo "   ターミナルで以下を実行してください:"
    echo "   brew install python3"
    echo ""
    read -p "Enterで閉じる..."
    exit 1
fi

echo "📦 ライブラリをインストール中（初回のみ時間がかかります）..."
pip3 install playwright html2text --quiet 2>/dev/null
python3 -m playwright install chromium --quiet 2>/dev/null
echo "✅ 準備完了"
echo ""

# Pythonスクリプトを一時ファイルに書き出して実行
python3 << 'PYEOF'
import asyncio
import re
import os
from pathlib import Path

OBSIDIAN_FOLDER = "/Users/kotomitooyama/kot_memo_obsidian/ブログ/ブログ教材「ワントップ」"
BASE_URL = "https://ayumi-bmethod.com/eztop/"

async def scrape():
    try:
        from playwright.async_api import async_playwright
        import html2text
    except ImportError:
        print("❌ ライブラリのインストールに失敗しました")
        input("Enterで閉じる...")
        return

    Path(OBSIDIAN_FOLDER).mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto(BASE_URL)

        print("")
        print("=" * 50)
        print("ブラウザが開きました。")
        print("ログインして、目次ページが表示されたら")
        print("このターミナルに戻って Enterキー を押してください")
        print("=" * 50)
        input()

        # ページ内のリンクを取得
        links = await page.eval_on_selector_all(
            "a[href]",
            "elements => elements.map(el => ({href: el.href, text: el.textContent.trim()}))"
        )

        # eztop配下のリンクを絞り込み・重複排除
        seen = set()
        course_links = []
        for l in links:
            href = l['href']
            if 'ayumi-bmethod.com/eztop/' in href and href != BASE_URL and href not in seen:
                seen.add(href)
                course_links.append(l)

        if not course_links:
            print("")
            print("⚠️  ページが見つかりませんでした。")
            print("   目次ページが表示された状態でEnterを押してください。")
            input("Enterで閉じる...")
            await browser.close()
            return

        print(f"\n📄 {len(course_links)}ページ見つかりました。保存を開始します...\n")

        h = html2text.HTML2Text()
        h.ignore_links = False
        h.body_width = 0
        h.ignore_images = True

        for i, link in enumerate(course_links, 1):
            url = link['href']
            title = ' '.join((link['text'] or f"page_{i}").split())

            # ファイル名に使えない文字を除去
            filename = re.sub(r'[\\/:*?"<>|]', '', title).strip()[:60]
            if not filename:
                filename = f"page_{i:03d}"

            print(f"[{i}/{len(course_links)}] {title}")

            try:
                await page.goto(url, wait_until='domcontentloaded', timeout=30000)
                await page.wait_for_timeout(1500)

                # メインコンテンツを優先して取得
                main_html = None
                for selector in ['article', 'main', '.entry-content', '.post-content', '#content', '.content']:
                    try:
                        el = page.locator(selector).first
                        if await el.count() > 0:
                            main_html = await el.inner_html()
                            break
                    except Exception:
                        continue

                if not main_html:
                    main_html = await page.content()

                markdown = h.handle(main_html)

                filepath = os.path.join(OBSIDIAN_FOLDER, f"{i:03d}_{filename}.md")

                # すでに保存済みのファイルはスキップ
                if os.path.exists(filepath):
                    print(f"  ⏭️  スキップ（保存済み）: {filename}.md")
                    continue

                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(f"# {title}\n\n")
                    f.write(f"URL: {url}\n\n---\n\n")
                    f.write(markdown)

                print(f"  ✅ 保存完了: {filename}.md")
                await asyncio.sleep(2)

            except Exception as e:
                print(f"  ❌ エラー: {e}")

        print("")
        print("=" * 50)
        print("✅ 全ページの保存が完了しました！")
        print(f"保存先: {OBSIDIAN_FOLDER}")
        print("=" * 50)
        input("\nEnterで閉じる...")
        await browser.close()

asyncio.run(scrape())
PYEOF

read -p ""
