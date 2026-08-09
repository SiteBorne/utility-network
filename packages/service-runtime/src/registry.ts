/**
 * Local service registry (directive §31). Contains exactly the implemented
 * v1 services. Unknown service IDs fail closed; duplicate registration
 * fails at startup rather than silently overwriting.
 */
import type { LocalService, ServiceId } from './types';

export interface RegisteredService {
  serviceId: ServiceId;
  implementationVersion: string;
  contractRelease: string;
  inputSchemaHash: string;
  outputSchemaHash: string;
  implementationStatus: 'local_fixture_verified' | 'not_implemented';
  productionEnabled: false;
  service: LocalService<unknown, unknown>;
}

export class ServiceRegistry {
  private readonly services = new Map<ServiceId, RegisteredService>();

  register(entry: RegisteredService): void {
    if (this.services.has(entry.serviceId)) {
      throw new Error(`duplicate service registration: ${entry.serviceId}`);
    }
    if (entry.productionEnabled !== false) {
      throw new Error(
        `refusing to register ${entry.serviceId} with productionEnabled !== false — production activation is out of SUN-0600 scope`
      );
    }
    this.services.set(entry.serviceId, entry);
  }

  get(serviceId: string): RegisteredService | undefined {
    return this.services.get(serviceId as ServiceId);
  }

  has(serviceId: string): boolean {
    return this.services.has(serviceId as ServiceId);
  }

  list(): RegisteredService[] {
    return [...this.services.values()];
  }
}
