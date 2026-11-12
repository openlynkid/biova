import { describe, expect, test } from "bun:test";
import { app } from "./index";

describe("openlynk api", () => {
  test("health endpoint reports ok", async () => {
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "openlynk-api", runtime: "bun" });
  });

  test("v1 endpoint advertises the service", async () => {
    const response = await app.handle(new Request("http://localhost/v1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Openlynk API", version: "0.1.0" });
  });
});
