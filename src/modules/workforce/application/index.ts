/**
 * The workforce APPLICATION boundary — its own entry point.
 *
 * `@/modules/workforce` is pure domain composition and stays free of Prisma;
 * `@/modules/workforce/persistence` composes the durable repositories;
 * THIS module is what a route, a server action or a script imports when it wants
 * to issue a Command and follow the lifecycle.
 *
 *   const application = await getWorkforceApplication();   // server, fail-closed
 *   const outcome = await application.commands.issueCommand(rawCommand);
 *
 * `getWorkforceApplication` refuses to boot on anything but a verified isolated
 * database, and it is the ONLY composition the running application uses. Tests
 * and offline proofs compose explicitly with `createWorkforceApplication`.
 */

export * from "./command-contracts";
export * from "./command-intent";
export * from "./command-service";
export * from "./composition";
export * from "./runtime";
