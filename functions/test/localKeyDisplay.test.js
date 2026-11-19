import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareLocalKeyDisplay } from "../scripts/local-key-display.mjs";

test("로컬 전달은 키를 HTML·URL에 넣지 않고 외부 출처를 거부하며 종료 시 제거한다", async () => {
  const d = await prepareLocalKeyDisplay({ openBrowser: false });
  try {
    const fakeKey = "시험용-비밀값";
    assert.equal((await fetch(d.url + "/key")).status, 202);
    d.show(fakeKey);
    assert.ok(!d.url.includes(fakeKey));
    const page = await fetch(d.url);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.ok(!((await page.text()).includes(fakeKey)));
    assert.equal((await fetch(d.url + "/key", { headers: { Origin: "https://example.com" } })).status, 403);
    assert.equal(await (await fetch(d.url + "/key")).text(), fakeKey);
    assert.deepEqual(await (await fetch(d.url + "/status")).json(), { ready: true, delivered: true });
    await fetch(d.url + "/close", { method: "POST" });
    await assert.rejects(fetch(d.url));
  } finally { d.stop(); }
});
