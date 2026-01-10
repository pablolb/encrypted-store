// Minimal PartyKit server for testing
// The actual Fireproof sync is handled by the "fireproof" party

import type * as Party from "partykit/server";

export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(_conn: Party.Connection, _ctx: Party.ConnectionContext) {
    // Not used - Fireproof handles its own party
  }
}
