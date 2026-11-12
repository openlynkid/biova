import { describe, expect, test } from "bun:test";
import { app } from "./index";

describe("biova api", () => {
  test("health endpoint reports ok", async () => {
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "biova-api", runtime: "bun" });
  });

  test("v1 endpoint advertises the service", async () => {
    const response = await app.handle(new Request("http://localhost/v1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Biova API", version: "0.1.0" });
  });
});
