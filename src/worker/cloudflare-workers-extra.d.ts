// Type declarations for Cloudflare Workers features not yet in @cloudflare/workers-types@4.20240620.0
// Remove this file once workers-types is updated to include Container.

declare module 'cloudflare:workers' {
  /**
   * Base class for Cloudflare Container bindings.
   * The container runs a Docker image alongside the Worker.
   */
  abstract class Container {
    /** Port the container listens on (default: 8080) */
    defaultPort: number;
    /** Duration string after which the container sleeps (e.g. '2m', '5m') */
    sleepAfter: string;

    /** Fetch a resource from the container */
    fetch(request: Request): Promise<Response>;
    /** Get the container's base URL */
    getTcpPort(port: number): string;
  }

  export { Container };
}
