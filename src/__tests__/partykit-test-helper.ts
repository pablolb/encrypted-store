import { spawn, ChildProcess } from "child_process";

export class PartykitTestServer {
  private process: ChildProcess | null = null;
  private port: number;

  constructor(port: number = 1999) {
    this.port = port;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Start PartyKit server
      this.process = spawn(
        "npx",
        ["partykit", "dev", "--port", String(this.port)],
        {
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        },
      );

      let output = "";

      // Collect output
      this.process.stdout?.on("data", (data) => {
        const text = data.toString();
        output += text;

        // PartyKit prints this when ready
        if (text.includes("Ready") || text.includes("localhost")) {
          console.log(`[PartyKit Test Server] Started on port ${this.port}`);
          resolve();
        }
      });

      this.process.stderr?.on("data", (data) => {
        output += data.toString();
      });

      this.process.on("error", (error) => {
        reject(new Error(`Failed to start PartyKit: ${error.message}`));
      });

      this.process.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`PartyKit exited with code ${code}\n${output}`));
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.process) {
          reject(
            new Error(`PartyKit server failed to start within 10s\n${output}`),
          );
        }
      }, 10000);
    });
  }

  async stop(): Promise<void> {
    if (this.process) {
      return new Promise((resolve) => {
        this.process!.on("exit", () => {
          console.log(`[PartyKit Test Server] Stopped`);
          resolve();
        });

        // Try graceful shutdown first
        this.process!.kill("SIGTERM");

        // Force kill after 2 seconds
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill("SIGKILL");
          }
        }, 2000);
      });
    }
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }
}
