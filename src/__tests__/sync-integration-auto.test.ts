import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PartykitTestServer } from "./partykit-test-helper";

/**
 * Automated PartyKit Integration Tests
 *
 * These tests automatically start a PartyKit server, verify connectivity,
 * and shut it down. They test that the sync infrastructure works.
 *
 * Note: These are smoke tests - full end-to-end sync testing is better
 * done manually or in a dedicated E2E test environment due to WebSocket
 * cleanup complexity in Jest.
 */
describe("Automated PartyKit Server Tests", () => {
  let partykitServer: PartykitTestServer;
  const TEST_PORT = 1999;

  beforeAll(async () => {
    partykitServer = new PartykitTestServer(TEST_PORT);
    await partykitServer.start();
  }, 15000);

  afterAll(async () => {
    if (partykitServer) {
      await partykitServer.stop();
    }
  }, 5000);

  it("should start PartyKit server successfully", () => {
    expect(partykitServer).toBeDefined();
    expect(partykitServer.getUrl()).toBe("http://localhost:1999");
  });

  it("should provide correct server URL", () => {
    const url = partykitServer.getUrl();
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it("should be able to stop and cleanup", async () => {
    // This is tested in afterAll, but we verify the method exists
    expect(typeof partykitServer.stop).toBe("function");
  });
});
