import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';

// The SDK skips falsy cancellation IDs. Prefix string IDs so numeric zero can
// use a truthy ID without colliding with any client-supplied string.
function encodeId(id: RequestId): RequestId {
  if (typeof id === 'string') return `:${id}`;
  return id === 0 ? '0' : id;
}

export class SuperzooStdioTransport extends StdioServerTransport {
  override start(): Promise<void> {
    const onmessage = this.onmessage;
    this.onmessage = message => {
      if ('method' in message) {
        if ('id' in message) {
          onmessage?.({ ...message, id: encodeId(message.id) });
          return;
        }
        const requestId = message.params?.requestId;
        if (message.method === 'notifications/cancelled' &&
            (typeof requestId === 'string' || typeof requestId === 'number')) {
          onmessage?.({ ...message, params: { ...message.params, requestId: encodeId(requestId) } });
          return;
        }
      }
      onmessage?.(message);
    };
    return super.start();
  }

  override send(message: JSONRPCMessage): Promise<void> {
    if (!('method' in message) && typeof message.id === 'string') {
      return super.send({ ...message, id: message.id === '0' ? 0 : message.id.slice(1) });
    }
    return super.send(message);
  }
}
