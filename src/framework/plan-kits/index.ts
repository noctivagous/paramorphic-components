import { createPlanInventory } from "../plan-inventory";
import { spreadsheetRecipe } from "./spreadsheet";

/** The standard inventory is a convenience; applications can create their own. */
export const planInventory = createPlanInventory();
planInventory.register(spreadsheetRecipe);
export { spreadsheetRecipe } from "./spreadsheet";
