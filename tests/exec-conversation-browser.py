"""Focused browser proof for the EXEC conversation integration.

The server and review cookie are supplied by the caller. This script never
mints, prints or persists credentials; it only imports the documented Netscape
cookie jar into an isolated Playwright context.
"""

from __future__ import annotations

import argparse
import json
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


def assert_no_horizontal_overflow(page: Page) -> None:
    overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
    assert not overflow, "page has horizontal overflow"


def open_exec(context: BrowserContext, base_url: str, width: int, height: int) -> Page:
    page = context.new_page()
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"{base_url}/command/exec", wait_until="networkidle")
    page.locator("textarea").wait_for(state="visible")
    assert_no_horizontal_overflow(page)
    return page


def send(page: Page, message: str) -> None:
    composer = page.locator("textarea")
    composer.fill(message)
    composer.press("Enter")


def success_journey(context: BrowserContext, base_url: str, output: Path) -> dict[str, object]:
    output.mkdir(parents=True, exist_ok=True)
    page = open_exec(context, base_url, 1440, 1000)
    requests: list[str] = []
    failed: list[str] = []
    page.on("request", lambda request: requests.append(request.url) if request.url.endswith("/api/exec/turn") else None)
    page.on("requestfailed", lambda request: failed.append(request.url) if request.url.endswith("/api/exec/turn") else None)

    assert page.get_by_text("رد اختباري — لا يوجد اتصال بنموذج حقيقي", exact=True).is_visible()
    assert page.get_by_text("الرسائل تُفقد عند تحديث الصفحة.", exact=True).is_visible()

    send(page, "مرحبًا EXEC")
    page.keyboard.press("Enter")
    page.get_by_text("في انتظار الرد الاختباري…", exact=True).wait_for(state="visible")
    assert page.locator(".nce-tool[data-tone='primary']").is_disabled()
    page.get_by_text("رد اختباري من الموصل الوهمي", exact=False).wait_for(state="visible", timeout=10_000)
    assert len(requests) == 1, f"expected one POST while pending, got {len(requests)}"
    desktop_success = output / "exec-integration-desktop-success.png"
    page.screenshot(path=str(desktop_success), full_page=False)

    page.reload(wait_until="networkidle")
    assert page.get_by_text("مرحبًا EXEC", exact=True).count() == 0
    assert page.get_by_text("رد اختباري من الموصل الوهمي", exact=False).count() == 0
    assert page.get_by_text("الرسائل تُفقد عند تحديث الصفحة.", exact=True).is_visible()

    send(page, "رد متأخر يجب تجاهله")
    page.get_by_text("في انتظار الرد الاختباري…", exact=True).wait_for(state="visible")
    page.locator(".nce-rail__new").click()
    page.wait_for_timeout(1_600)
    assert page.get_by_text("رد اختباري من الموصل الوهمي", exact=False).count() == 0
    assert page.locator(".nce-thread .nce-msg").count() == 0

    leaving = context.new_page()
    leaving.set_viewport_size({"width": 1280, "height": 800})
    leave_failed: list[str] = []
    leave_aborts: list[bool] = []
    leaving.expose_function("recordExecAbort", lambda: leave_aborts.append(True))
    leaving.add_init_script(
        """
        {
          const originalFetch = window.fetch.bind(window);
          window.fetch = function (input, init = {}) {
            const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
            const url = new URL(rawUrl, window.location.href);
            if (url.pathname === "/api/exec/turn" && init.signal) {
              init.signal.addEventListener("abort", () => window.recordExecAbort(), { once: true });
            }
            return originalFetch(input, init);
          };
        }
        """
    )
    leaving.goto(f"{base_url}/command/exec", wait_until="networkidle")
    leaving.locator("textarea").wait_for(state="visible")
    leave_aborts.clear()
    leaving.on(
        "requestfailed",
        lambda request: leave_failed.append(request.url) if request.url.endswith("/api/exec/turn") else None,
    )
    with leaving.expect_request(lambda request: request.url.endswith("/api/exec/turn")):
        send(leaving, "إلغاء عند مغادرة الصفحة")
    leaving.get_by_text("في انتظار الرد الاختباري…", exact=True).wait_for(state="visible")
    leaving.locator(".nce-top__back").click()
    leaving.wait_for_url(f"{base_url}/command")
    leaving.wait_for_timeout(300)
    leaving.close()

    mobile = open_exec(context, base_url, 390, 844)
    mobile.locator(".nce-menu__btn").click()
    mobile.get_by_role("menuitem", name="اللغة", exact=True).click()
    mobile.locator(".nce[lang='en']").wait_for()
    assert mobile.get_by_text("Test reply — no real model connection", exact=True).is_visible()
    assert mobile.get_by_text("Messages are lost when the page is refreshed.", exact=True).is_visible()
    send(mobile, "Hello EXEC")
    mobile.get_by_text("رد اختباري من الموصل الوهمي", exact=False).wait_for(state="visible", timeout=10_000)
    assert_no_horizontal_overflow(mobile)
    mobile_success = output / "exec-integration-mobile-success.png"
    mobile.screenshot(path=str(mobile_success), full_page=False)

    page.close()
    mobile.close()
    return {
        "mode": "success",
        "postCount": len(requests),
        "abortedRequestObserved": len(failed) > 0,
        "pageLeaveExecAbortObserved": len(leave_aborts) > 0,
        "pageLeaveRequestFailedEvent": len(leave_failed) > 0,
        "pageLeaveCancellationProof": (
            "observed" if leave_aborts or leave_failed else "not observable before document teardown"
        ),
        "refreshClearedConversation": True,
        "screenshots": [str(desktop_success.resolve()), str(mobile_success.resolve())],
    }


def error_journey(context: BrowserContext, base_url: str, output: Path) -> dict[str, object]:
    output.mkdir(parents=True, exist_ok=True)
    page = open_exec(context, base_url, 1440, 1000)
    requests: list[str] = []
    page.on("request", lambda request: requests.append(request.url) if request.url.endswith("/api/exec/turn") else None)

    send(page, "اختبار فشل الموصل")
    page.get_by_text("الموصل الاختباري غير متاح. لم يُنفَّذ شيء.", exact=False).wait_for(
        state="visible", timeout=10_000
    )
    assert page.get_by_text("هذه واجهة تجريبية", exact=False).count() == 0
    assert page.get_by_text("رد اختباري من الموصل الوهمي", exact=False).count() == 0
    assert len(requests) == 1, f"expected one failed POST and no fallback, got {len(requests)}"
    screenshot = output / "exec-integration-desktop-error.png"
    page.screenshot(path=str(screenshot), full_page=False)
    page.close()
    return {"mode": "error", "postCount": len(requests), "screenshots": [str(screenshot.resolve())]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--cookie-jar", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=("success", "error"), required=True)
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context()
        context.add_cookies(read_cookie_jar(args.cookie_jar))
        result = (
            success_journey(context, args.base_url, args.output)
            if args.mode == "success"
            else error_journey(context, args.base_url, args.output)
        )
        context.close()
        browser.close()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
