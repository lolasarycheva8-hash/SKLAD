import { Router, type IRouter } from "express";
import healthRouter from "./health";
import categoriesRouter from "./categories";
import productsRouter from "./products";
import goodsReceiptsRouter from "./goods-receipts";
import dashboardRouter from "./dashboard";
import sitesRouter from "./sites";
import tradeNamesRouter from "./trade-names";
import deliveryTypesRouter from "./delivery-types";
import deliveriesRouter from "./deliveries";
import clientsRouter from "./clients";
import ordersRouter from "./orders";
import shipmentsRouter from "./shipments";
import usersRouter, { publicUsersRouter } from "./users";
import myRouter from "./my";
import auditRouter from "./audit";
import inventoryRouter from "./inventory";
import storageRouter from "./storage";
import lookupsRouter from "./lookups";
import legacyDriverAssignmentsRouter from "./legacy-driver-assignments";
import { requireAuth } from "../middlewares/requireAuth";
import { auditLog } from "../middlewares/auditLog";

const router: IRouter = Router();

// Health check stays unauthenticated so uptime/monitoring probes can reach it.
router.use(healthRouter);
router.use(publicUsersRouter);

router.use(requireAuth);

// Record every mutating request (after auth so we know who did it).
router.use(auditLog);

router.use(usersRouter);
router.use(legacyDriverAssignmentsRouter);
router.use(auditRouter);
router.use(myRouter);
router.use(categoriesRouter);
router.use(productsRouter);
router.use(goodsReceiptsRouter);
router.use(dashboardRouter);
router.use(sitesRouter);
router.use(tradeNamesRouter);
router.use(deliveryTypesRouter);
router.use(deliveriesRouter);
router.use(clientsRouter);
router.use(ordersRouter);
router.use(shipmentsRouter);
router.use(inventoryRouter);
router.use(storageRouter);
router.use(lookupsRouter);

export default router;
