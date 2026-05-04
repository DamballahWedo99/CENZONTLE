import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "./modules/auth/decorators";

/**
 * @SkipThrottle: load balancers (ALB, GCP LB, k8s liveness probes) pingean
 * /health a frecuencia alta (10-30 req/30s). Sin skip, esos pings consumen
 * el budget global de throttle y starvan a usuarios reales — peor con
 * AuthAwareThrottlerGuard porque caen al fallback `ip:<lb>` que es shared.
 */
@Public()
@SkipThrottle()
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
