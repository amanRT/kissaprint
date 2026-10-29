"""Shared headless-Chrome helpers for the render + QA scripts (Selenium 4 downloads chromedriver itself)."""
import base64
import os
import time

os.environ.setdefault("SE_AVOID_STATS", "true")  # no Selenium Manager telemetry

from selenium import webdriver  # noqa: E402
from selenium.webdriver.chrome.options import Options


def make_driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--hide-scrollbars")
    opts.add_argument("--window-size=1440,1000")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return webdriver.Chrome(options=opts)


def set_viewport(driver, width, height, dpr=1.0, mobile=False):
    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride",
                           {"width": width, "height": height, "deviceScaleFactor": dpr, "mobile": mobile})


def wait_ready(driver, timeout=20):
    """Wait for fonts and every <img> (including lazy ones already in view) to finish loading."""
    end = time.time() + timeout
    while time.time() < end:
        done = driver.execute_script(
            "return document.readyState === 'complete' && document.fonts.status === 'loaded' && "
            "[...document.images].every(i => i.loading === 'lazy' || i.complete);")
        if done:
            return True
        time.sleep(0.15)
    return False


def screenshot(driver, path, clip=None, full_page=False):
    params = {"format": "png", "captureBeyondViewport": full_page}
    if clip:
        params["clip"] = {**clip, "scale": 1}
    data = driver.execute_cdp_cmd("Page.captureScreenshot", params)["data"]
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(data))
