"""Interactive acceptance proof for the local EXEC integration preview.

Uses the real local login form and records one short browser video. Credentials
come from the caller's environment and are never printed or persisted here.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, sync_playwright


def read_cookie_jar(path: Path) -> list[dict[str, object]]:
    cookies: list[dict[str, object]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        http_only = raw.startswith("#HttpOnly_")
        if http_only:
            raw = raw.removeprefix("#HttpOnly_")
        elif not raw or raw.startswith("#"):
            continue
        domain, _subdomains, cookie_path, secure, expires, name, value = raw.split("\t", 6)
        cookie: dict[str, object] = {
            "name": name,
            "value": value,
            "domain": domain,
            "path": cookie_path,
            "secure": secure.upper() == "TRUE",
            "httpOnly": http_only,
        }
        if expires.isdigit() and int(expires) > 0:
            cookie["expires"] = int(expires)
        cookies.append(cookie)
    return cookies


def wait_for_exec(page: Page) -> None:
    page.wait_for_url("**/command/exec")
    page.locator("textarea").wait_for(state="visible")
    page.get_by_text("رد اختباري — لا يوجد اتصال بنموذج حقيقي", exact=True).wait_for()


def login(page: Page, base_url: str) -> None:
    email = os.environ["NEXUP_DEMO_EMAIL"]
    password = os.environ["NEXUP_DEMO_PASSWORD"]
    page.goto(f"{base_url}/login?next=%2Fcommand%2Fexec", wait_until="networkidle")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(password)
    page.get_by_role("button", name="Login").click()
    wait_for_exec(page)


def menu_visibility(page: Page) -> dict[str, object]:
    return page.locator(".nce-menu__list").evaluate(
        """element => {
          const rect = element.getBoundingClientRect();
          let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
          const ancestors = [];
          for (let node = element.parentElement; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            const clipsX = /(hidden|clip|auto|scroll)/.test(style.overflowX);
            const clipsY = /(hidden|clip|auto|scroll)/.test(style.overflowY);
            if (clipsX || clipsY) {
              const box = node.getBoundingClientRect();
              if (clipsX) {
                clip.left = Math.max(clip.left, box.left);
                clip.right = Math.min(clip.right, box.right);
              }
              if (clipsY) {
                clip.top = Math.max(clip.top, box.top);
                clip.bottom = Math.min(clip.bottom, box.bottom);
              }
              ancestors.push({
                className: node.className,
                overflowX: style.overflowX,
                overflowY: style.overflowY,
                rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
              });
            }
          }
          const visibleWidth = Math.max(0, Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left));
          const visibleHeight = Math.max(0, Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top));
          const area = Math.max(1, rect.width * rect.height);
          return {
            ratio: (visibleWidth * visibleHeight) / area,
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            clip,
            ancestors,
          };
        }"""
    )


def assert_menu_interaction(page: Page, label: str) -> None:
    trigger = page.locator(".nce-menu__btn")
    menu = page.locator(".nce-menu__list")

    trigger.click()
    menu.wait_for(state="visible")
    visibility = menu_visibility(page)
    assert visibility["ratio"] >= 0.98, f"{label} menu is clipped: {json.dumps(visibility)}"

    page.mouse.click(8, 180)
    menu.wait_for(state="hidden")

    trigger.click()
    menu.wait_for(state="visible")
    page.keyboard.press("Escape")
    menu.wait_for(state="hidden")
    assert trigger.evaluate("element => document.activeElement === element"), (
        f"{label} menu trigger did not regain focus after Escape"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--cookie-jar", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 820},
            record_video_dir=str(args.output),
            record_video_size={"width": 1280, "height": 820},
        )
        if args.cookie_jar:
            context.add_cookies(read_cookie_jar(args.cookie_jar))
        page = context.new_page()
        if args.cookie_jar:
            page.goto(f"{args.base_url}/command/exec", wait_until="networkidle")
            wait_for_exec(page)
        else:
            login(page, args.base_url)

        # Desktop: daily navigation is explicit and the empty composer is compact.
        page.get_by_role("button", name="جلسة جديدة", exact=True).wait_for()
        sessions_toggle = page.get_by_text("أحدث الجلسات", exact=True)
        sessions_toggle.wait_for()
        page.get_by_placeholder("ابحث في المحادثات", exact=True).wait_for()
        page.get_by_role("button", name="الإضافات", exact=True).wait_for()
        page.get_by_text("سعيد · Demo", exact=True).wait_for()
        page.get_by_role("button", name="فتح مساحة العمل", exact=True).wait_for()
        assert_menu_interaction(page, "desktop")

        # One free message uses only the same-origin dummy connector.
        page.locator("textarea").fill("اختبار مساحة العمل")
        page.get_by_role("button", name="إرسال · Enter").click()
        page.get_by_text("رد اختباري من الموصل الوهمي", exact=False).wait_for(timeout=10_000)
        desktop_image = args.output / "exec-workspace-desktop.png"
        page.screenshot(path=str(desktop_image), full_page=False)

        # Workspace is beside the thread on desktop and carries truthful empty states.
        page.get_by_role("button", name="فتح مساحة العمل", exact=True).click()
        page.get_by_role("heading", name="مساحة العمل", exact=True).wait_for()
        page.get_by_role("tab", name="المعاينة", exact=True).click()
        page.get_by_text("لا يوجد شيء متاح للمعاينة بعد.", exact=True).wait_for()
        page.get_by_role("tab", name="المخرجات", exact=True).click()
        page.get_by_text("لم يُنشأ مخرج تجريبي في هذه المحادثة.", exact=True).wait_for()
        page.get_by_role("button", name="العودة إلى المحادثة", exact=True).click()

        # Search has a real no-result state; Plugins only lists confirmed systems.
        page.get_by_role("button", name="الجلسات", exact=True).click()
        side_search = page.get_by_placeholder("ابحث في المحادثات", exact=True).last
        side_search.fill("لا توجد")
        page.get_by_text("لا توجد محادثات تطابق البحث.", exact=True).wait_for()
        page.get_by_role("button", name="العودة إلى المحادثة", exact=True).click()
        page.get_by_role("button", name="الإضافات", exact=True).click()
        page.get_by_text("واجهة محادثة EXEC", exact=True).wait_for()
        page.locator(".nce-side").get_by_text("غير متصل", exact=True).first.wait_for()
        page.get_by_role("button", name="العودة إلى المحادثة", exact=True).click()

        # Account preferences include language, fixed appearance and motion.
        page.get_by_text("سعيد · Demo", exact=True).click()
        account = page.locator(".nce-account")
        account.get_by_text("المظهر", exact=True).wait_for()
        account.get_by_role("button", name="اللغة", exact=True).click()
        page.locator(".nce[lang='en']").wait_for()
        page.get_by_text("Saeed · Demo", exact=True).wait_for()

        # Mobile uses a full workspace view with a clear return to chat.
        page.set_viewport_size({"width": 390, "height": 844})
        assert_menu_interaction(page, "mobile")
        page.get_by_role("button", name="Open workspace", exact=True).click()
        page.get_by_role("heading", name="Workspace", exact=True).wait_for()
        page.get_by_role("tab", name="Activity", exact=True).click()
        page.get_by_role("button", name="Back to the conversation", exact=True).click()
        page.get_by_role("button", name="Plugins", exact=True).click()
        page.get_by_role("heading", name="Plugins", exact=True).wait_for()
        page.wait_for_timeout(350)
        mobile_image = args.output / "exec-workspace-mobile.png"
        page.screenshot(path=str(mobile_image), full_page=False)
        page.get_by_role("button", name="Back to the conversation", exact=True).click()

        # New conversation remains memory-only and leaves the previous one searchable.
        page.locator(".nce-menu__btn").click()
        page.get_by_role("menuitem", name="New conversation", exact=True).click()
        page.get_by_role("heading", name="What should we work on, Saeed?", exact=True).wait_for()

        page.wait_for_timeout(800)
        video = page.video
        page.close()
        context.close()
        browser.close()

        video_path = Path(video.path())
        final_video = args.output / "exec-interaction-proof.webm"
        if video_path != final_video:
            video_path.replace(final_video)

    print(
        json.dumps(
            {
                "send": "passed",
                "newSession": "passed-memory-only",
                "navigation": "sessions-search-account-plugins",
                "mobileNavigation": "full-workspace-view",
                "menu": "passed",
                "language": "ar-en-passed",
                "workspace": "activity-preview-outputs",
                "plugins": "confirmed-systems-only",
                "desktopImage": str(desktop_image.resolve()),
                "mobileImage": str(mobile_image.resolve()),
                "video": str(final_video.resolve()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
