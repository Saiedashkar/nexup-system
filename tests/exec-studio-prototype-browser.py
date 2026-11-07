"""Three-state visual acceptance for the isolated EXEC Studio prototype."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--cookie-jar", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 960})
        context.add_cookies(read_cookie_jar(args.cookie_jar))
        page = context.new_page()
        page.goto(f"{args.base_url}/command/exec/prototype", wait_until="networkidle")

        surface = page.locator(".nxp")
        surface.wait_for()
        mobile_menu = page.get_by_role("button", name="فتح قائمة المحادثات", exact=True)
        assert not mobile_menu.is_visible(), "mobile drawer control must not occupy the desktop header"
        page.get_by_role("heading", name="إيه اللي نشتغل عليه يا سعيد؟", exact=True).wait_for()
        page.locator(".nxp-composer textarea").wait_for()

        # The desktop sidebar is the only conversation list. It folds without
        # touching the draft, and a session opens directly in the main area.
        draft = page.locator(".nxp-composer textarea")
        draft.fill("مسودة تبقى أثناء التنقل")
        page.get_by_role("button", name="طي قائمة المحادثات", exact=True).click()
        page.locator('.nxp[data-sidebar="collapsed"]').wait_for()
        page.get_by_role("button", name="توسيع قائمة المحادثات", exact=True).click()
        assert draft.input_value() == "مسودة تبقى أثناء التنقل"
        page.get_by_role("button", name="خطة إطلاق الربع القادم", exact=True).click()
        page.get_by_text("نبدأ بتحديد هدف الإطلاق", exact=False).wait_for()
        assert page.get_by_role("button", name="خطة إطلاق الربع القادم", exact=True).get_attribute("aria-current") == "true"
        page.get_by_role("button", name="محادثة جديدة", exact=True).click()
        page.get_by_role("heading", name="إيه اللي نشتغل عليه يا سعيد؟", exact=True).wait_for()

        # Plugins and Settings are primary destinations, never opposite-side
        # panels. Back restores the untouched chat draft.
        page.locator(".nxp-composer textarea").fill("مسودة قبل الوجهات")
        page.get_by_role("button", name="Plugins", exact=True).click()
        page.get_by_role("heading", name="Plugins", exact=True).wait_for()
        assert page.locator(".nxp-workspace").count() == 0
        page.get_by_role("button", name="الرجوع للمحادثة", exact=True).click()
        assert page.locator(".nxp-composer textarea").input_value() == "مسودة قبل الوجهات"
        page.get_by_role("button", name="الإعدادات", exact=True).click()
        page.get_by_role("heading", name="الإعدادات", exact=True).wait_for()
        page.get_by_role("button", name="الرجوع للمحادثة", exact=True).click()
        page.locator(".nxp-composer textarea").fill("")

        start_image = args.output / "01-exec-start.png"
        page.screenshot(path=str(start_image), full_page=False)

        page.locator(".nxp-composer textarea").fill("جهّز خطة إطلاق مختصرة")
        page.get_by_role("button", name="إرسال", exact=True).click()
        page.get_by_text("نبدأ بتحديد هدف الإطلاق", exact=False).wait_for()
        page.get_by_role("button", name="فتح مساحة العمل", exact=True).click()
        workspace = page.locator(".nxp-workspace")
        workspace.wait_for()
        page.get_by_role("tab", name="النشاط", exact=True).wait_for()

        thread_box = page.locator(".nxp-thread").bounding_box()
        workspace_box = workspace.bounding_box()
        assert thread_box and workspace_box
        assert thread_box["x"] + thread_box["width"] <= workspace_box["x"] + 1 or (
            workspace_box["x"] + workspace_box["width"] <= thread_box["x"] + 1
        ), "workspace must sit beside the conversation, not cover it"
        conversation_image = args.output / "02-exec-conversation-workspace.png"
        page.screenshot(path=str(conversation_image), full_page=False)

        workspace.locator("header > .nxp-iconbtn").click()
        page.set_viewport_size({"width": 390, "height": 844})
        mobile_draft = page.locator(".nxp-composer textarea")
        mobile_draft.fill("مسودة موبايل")
        mobile_menu.click()
        drawer = page.locator(".nxp-drawer")
        drawer.wait_for()
        drawer.get_by_placeholder("ابحث في المحادثات", exact=True).wait_for()
        page.wait_for_timeout(240)
        assert mobile_draft.input_value() == "مسودة موبايل"
        mobile_image = args.output / "03-exec-mobile-sessions.png"
        page.screenshot(path=str(mobile_image), full_page=False)

        # Choosing a conversation closes the same drawer and marks it active.
        drawer.get_by_role("button", name="مراجعة وضع الشركة", exact=True).click()
        drawer.wait_for(state="hidden")
        page.locator(".nxp-thread__messages").get_by_text("مراجعة وضع الشركة", exact=True).wait_for()
        mobile_menu.click()
        drawer.wait_for()
        assert drawer.get_by_role("button", name="مراجعة وضع الشركة", exact=True).get_attribute("aria-current") == "true"

        # RTL puts the drawer at inline-start (right); switching language moves
        # that same drawer to inline-start (left) without creating another nav.
        rtl_box = drawer.bounding_box()
        assert rtl_box and rtl_box["x"] > 0
        drawer.locator(".nxp-account > summary").click()
        drawer.get_by_role("button", name="English", exact=True).click()
        page.locator('.nxp[dir="ltr"]').wait_for()
        ltr_box = drawer.bounding_box()
        assert ltr_box and ltr_box["x"] < 2
        drawer.get_by_role("button", name="Plugins", exact=True).click()
        drawer.wait_for(state="hidden")
        page.get_by_role("heading", name="Plugins", exact=True).wait_for()
        assert page.locator(".nxp-workspace").count() == 0

        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        browser.close()

    print(json.dumps({
        "start": str(start_image.resolve()),
        "conversationWorkspace": str(conversation_image.resolve()),
        "mobileSessions": str(mobile_image.resolve()),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
