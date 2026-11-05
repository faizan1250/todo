import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";

function newDeviceId() {
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function register(
  authHeaders: Record<string, string>,
  body: Record<string, unknown>
) {
  return app.handle(
    new Request("http://localhost:3001/api/v1/sync/devices", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
    })
  );
}

async function listDevices(authHeaders: Record<string, string>) {
  const res = await app.handle(
    new Request("http://localhost:3001/api/v1/sync/devices", {
      headers: authHeaders,
    })
  );
  expect(res.status).toBe(200);
  const data = (await res.json()) as {
    devices: Array<{
      id: string;
      name: string | null;
      platform: string;
      lastSeenAt: number | null;
      lastSyncAt: number | null;
    }>;
  };
  return data.devices;
}

describe("Sync devices", () => {
  it("register creates a device and re-register updates name", async () => {
    const { authHeaders } = await createAuthUser("SyncDevReg");
    const id = newDeviceId();

    const first = await register(authHeaders, {
      deviceId: id,
      name: "My Phone",
      platform: "ios",
    });
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as any;
    expect(firstData.id).toBe(id);
    expect(firstData.name).toBe("My Phone");
    expect(firstData.platform).toBe("ios");
    expect(typeof firstData.lastSeenAt).toBe("number");

    const second = await register(authHeaders, {
      deviceId: id,
      name: "My Renamed Phone",
    });
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as any;
    expect(secondData.id).toBe(id);
    expect(secondData.name).toBe("My Renamed Phone");
    expect(secondData.platform).toBe("web");

    // Still exactly one row for this device.
    const devices = await listDevices(authHeaders);
    expect(devices.filter((d) => d.id === id)).toHaveLength(1);
    expect(devices.find((d) => d.id === id)?.name).toBe("My Renamed Phone");
  });

  it("list returns own devices only (user B isolation)", async () => {
    const userA = await createAuthUser("SyncDevListA");
    const userB = await createAuthUser("SyncDevListB");
    const idA = newDeviceId();
    const idB = newDeviceId();

    expect(
      (await register(userA.authHeaders, { deviceId: idA, name: "A Phone" }))
        .status
    ).toBe(200);
    expect(
      (await register(userB.authHeaders, { deviceId: idB, name: "B Phone" }))
        .status
    ).toBe(200);

    const devicesA = await listDevices(userA.authHeaders);
    const devicesB = await listDevices(userB.authHeaders);

    expect(devicesA.some((d) => d.id === idA)).toBe(true);
    expect(devicesA.some((d) => d.id === idB)).toBe(false);
    expect(devicesB.some((d) => d.id === idB)).toBe(true);
    expect(devicesB.some((d) => d.id === idA)).toBe(false);
  });

  it("registering an id owned by another user returns 403", async () => {
    const userA = await createAuthUser("SyncDevAlienA");
    const userB = await createAuthUser("SyncDevAlienB");
    const id = newDeviceId();

    const legit = await register(userA.authHeaders, {
      deviceId: id,
      name: "A device",
    });
    expect(legit.status).toBe(200);

    const hijack = await register(userB.authHeaders, {
      deviceId: id,
      name: "Hijacked",
    });
    expect(hijack.status).toBe(403);

    // Victim's row is untouched.
    const devicesA = await listDevices(userA.authHeaders);
    expect(devicesA.find((d) => d.id === id)?.name).toBe("A device");
    const devicesB = await listDevices(userB.authHeaders);
    expect(devicesB.some((d) => d.id === id)).toBe(false);
  });
});
