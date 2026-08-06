import type { QueueDispatch, QueueDispatchRepository } from '../repositories/interfaces';

export interface QueueDispatchMessage {
  job_id: string;
  attempt_number: number;
  service_id: string;
  service_version: string;
  input_artifact_ref: string;
  contract_hash: string;
  trace_context: string;
  dispatched_at: string;
  expires_at: string;
  retry_count: number;
}

export interface QueueProducer {
  send(message: QueueDispatchMessage): Promise<void>;
}

export interface QueueConsumer {
  receive(batchSize?: number, waitTimeSeconds?: number): Promise<QueueDispatchMessage[]>;
  acknowledge(message: QueueDispatchMessage): Promise<void>;
  release(message: QueueDispatchMessage): Promise<void>;
}

export class InMemoryQueueProducer implements QueueProducer {
  private queue: QueueDispatchMessage[] = [];

  async send(message: QueueDispatchMessage): Promise<void> {
    this.queue.push(message);
  }

  getQueue(): QueueDispatchMessage[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
  }
}

export class InMemoryQueueConsumer implements QueueConsumer {
  private queue: QueueDispatchMessage[] = [];

  constructor(queue?: QueueDispatchMessage[]) {
    if (queue) this.queue = queue;
  }

  setQueue(messages: QueueDispatchMessage[]): void {
    this.queue = messages;
  }

  async receive(batchSize = 10, _waitTimeSeconds = 0): Promise<QueueDispatchMessage[]> {
    const batch = this.queue.splice(0, batchSize);
    return batch.filter((msg) => new Date(msg.expires_at) > new Date());
  }

  async acknowledge(_message: QueueDispatchMessage): Promise<void> {
    // No-op for in-memory
  }

  async release(message: QueueDispatchMessage): Promise<void> {
    await this.queue.retry(message);
  }
}

export class QueueDispatchHandler {
  constructor(
    private producer: QueueProducer,
    private repository: QueueDispatchRepository
  ) {}

  async dispatch(
    jobId: string,
    attemptNumber: number,
    serviceId: string,
    serviceVersion: string,
    inputArtifactRef: string,
    contractHash: string,
    traceContext: string,
    expiresAt: string
  ): Promise<QueueDispatch> {
    const existing = await this.repository.getByJobIdAndAttempt(jobId, attemptNumber);
    if (existing.ok && existing.value) {
      return existing.value;
    }

    const dispatch: QueueDispatch = {
      id: crypto.randomUUID(),
      job_id: jobId,
      attempt_number: attemptNumber,
      service_id: serviceId,
      service_version: serviceVersion,
      input_artifact_ref: inputArtifactRef,
      contract_hash: contractHash,
      trace_context: traceContext,
      dispatched_at: new Date().toISOString(),
      expires_at: expiresAt,
      retry_count: 0,
    };

    const created = await this.repository.create(dispatch);
    if (!created.ok) {
      throw new Error(`Failed to create dispatch: ${created.error.message}`);
    }

    const message: QueueDispatchMessage = {
      job_id: dispatch.job_id,
      attempt_number: dispatch.attempt_number,
      service_id: dispatch.service_id,
      service_version: dispatch.service_version,
      input_artifact_ref: dispatch.input_artifact_ref,
      contract_hash: dispatch.contract_hash,
      trace_context: dispatch.trace_context,
      dispatched_at: dispatch.dispatched_at,
      expires_at: dispatch.expires_at,
      retry_count: dispatch.retry_count,
    };

    await this.producer.send(message);
    return dispatch;
  }

  async handleDuplicateDelivery(
    message: QueueDispatchMessage
  ): Promise<{ isDuplicate: boolean; dispatch?: QueueDispatch }> {
    const existing = await this.repository.getByJobIdAndAttempt(
      message.job_id,
      message.attempt_number
    );
    if (existing.ok && existing.value) {
      return { isDuplicate: true, dispatch: existing.value };
    }
    return { isDuplicate: false };
  }

  async validateMessage(
    message: QueueDispatchMessage
  ): Promise<{ valid: boolean; reason?: string }> {
    if (new Date(message.expires_at) <= new Date()) {
      return { valid: false, reason: 'Message expired' };
    }
    if (message.retry_count > 5) {
      return { valid: false, reason: 'Max retries exceeded' };
    }
    return { valid: true };
  }
}

export class R2QueueProducerAdapter implements QueueProducer {
  private queue: Queue;

  constructor(queue: Queue) {
    this.queue = queue;
  }

  async send(message: QueueDispatchMessage): Promise<void> {
    await this.queue.send(message);
  }
}

export class R2QueueConsumerAdapter implements QueueConsumer {
  private queue: Queue;

  constructor(queue: Queue) {
    this.queue = queue;
  }

  async receive(batchSize = 10, waitTimeSeconds = 5): Promise<QueueDispatchMessage[]> {
    const batch = await this.queue.receive(batchSize, waitTimeSeconds);
    return batch.messages.map((m) => m.body as QueueDispatchMessage);
  }

  async acknowledge(_message: QueueDispatchMessage): Promise<void> {
    // Cloudflare Queues auto-acknowledges on successful handler completion
  }

  async release(message: QueueDispatchMessage): Promise<void> {
    await this.queue.retry(message);
  }
}
