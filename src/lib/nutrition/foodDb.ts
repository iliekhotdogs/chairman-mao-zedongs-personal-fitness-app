/**
 * Built-in reference foods used for offline search and the simulated photo estimator.
 *
 * Values are per 100 g, rounded from USDA FoodData Central generic entries (SR Legacy /
 * FNDDS). They are reference values for typical preparations — real dishes vary. Restaurant-
 * style items here are *generic* estimates and are labelled as such; official restaurant data
 * comes from the server nutrition service when it is configured.
 */

export interface RefFood {
  id: string;
  name: string;
  aliases: string[];
  kcal: number;
  p: number;
  c: number;
  f: number;
  portions: { label: string; grams: number }[];
  generic?: 'restaurant' | 'homemade';
}

export const FOOD_DB: RefFood[] = [
  { id: 'chicken_breast', name: 'Chicken breast, cooked, skinless', aliases: ['chicken', 'chicken breast', 'grilled chicken'], kcal: 165, p: 31, c: 0, f: 3.6, portions: [{ label: '1 palm-size piece', grams: 120 }, { label: '1 breast', grams: 172 }] },
  { id: 'chicken_thigh', name: 'Chicken thigh, cooked, skinless', aliases: ['chicken thigh', 'thighs'], kcal: 179, p: 24.8, c: 0, f: 8.2, portions: [{ label: '1 thigh', grams: 90 }] },
  { id: 'ground_beef', name: 'Ground beef 85% lean, cooked', aliases: ['ground beef', 'mince', 'beef'], kcal: 250, p: 25.9, c: 0, f: 15.4, portions: [{ label: '4 oz cooked', grams: 113 }] },
  { id: 'steak', name: 'Beef steak (sirloin), cooked', aliases: ['steak', 'sirloin'], kcal: 206, p: 29, c: 0, f: 9.5, portions: [{ label: '6 oz steak', grams: 170 }] },
  { id: 'salmon', name: 'Salmon, cooked', aliases: ['salmon', 'fish'], kcal: 206, p: 22.1, c: 0, f: 12.4, portions: [{ label: '1 fillet', grams: 150 }] },
  { id: 'tuna_can', name: 'Tuna, canned in water, drained', aliases: ['tuna'], kcal: 116, p: 25.5, c: 0, f: 0.8, portions: [{ label: '1 can', grams: 142 }] },
  { id: 'egg', name: 'Egg, whole, cooked', aliases: ['egg', 'eggs', 'boiled egg'], kcal: 155, p: 12.6, c: 1.1, f: 10.6, portions: [{ label: '1 large egg', grams: 50 }] },
  { id: 'scrambled_eggs', name: 'Scrambled eggs', aliases: ['scrambled eggs', 'scrambled'], kcal: 148, p: 10, c: 1.6, f: 11, portions: [{ label: '2 eggs', grams: 120 }] },
  { id: 'bacon', name: 'Bacon, cooked', aliases: ['bacon'], kcal: 541, p: 37, c: 1.4, f: 42, portions: [{ label: '3 slices', grams: 24 }] },
  { id: 'tofu', name: 'Tofu, firm', aliases: ['tofu'], kcal: 144, p: 17.3, c: 2.8, f: 8.7, portions: [{ label: '1/2 block', grams: 170 }] },
  { id: 'white_rice', name: 'White rice, cooked', aliases: ['rice', 'white rice'], kcal: 130, p: 2.7, c: 28.2, f: 0.3, portions: [{ label: '1 cup', grams: 158 }] },
  { id: 'brown_rice', name: 'Brown rice, cooked', aliases: ['brown rice'], kcal: 123, p: 2.7, c: 25.6, f: 1, portions: [{ label: '1 cup', grams: 195 }] },
  { id: 'pasta', name: 'Pasta, cooked', aliases: ['pasta', 'spaghetti', 'noodles', 'penne'], kcal: 158, p: 5.8, c: 30.9, f: 0.9, portions: [{ label: '1 cup', grams: 140 }] },
  { id: 'white_bread', name: 'White bread', aliases: ['bread', 'toast', 'white bread'], kcal: 266, p: 9, c: 49, f: 3.2, portions: [{ label: '1 slice', grams: 28 }] },
  { id: 'wheat_bread', name: 'Whole-wheat bread', aliases: ['whole wheat bread', 'wheat toast', 'wholemeal'], kcal: 252, p: 12.4, c: 42.7, f: 3.5, portions: [{ label: '1 slice', grams: 32 }] },
  { id: 'oats', name: 'Rolled oats, dry', aliases: ['oats', 'rolled oats'], kcal: 379, p: 13.2, c: 67.7, f: 6.5, portions: [{ label: '1/2 cup dry', grams: 40 }] },
  { id: 'oatmeal', name: 'Oatmeal, cooked with water', aliases: ['oatmeal', 'porridge'], kcal: 71, p: 2.5, c: 12, f: 1.5, portions: [{ label: '1 cup', grams: 234 }] },
  { id: 'potato', name: 'Potato, baked', aliases: ['potato', 'baked potato'], kcal: 93, p: 2.5, c: 21.2, f: 0.1, portions: [{ label: '1 medium', grams: 173 }] },
  { id: 'sweet_potato', name: 'Sweet potato, baked', aliases: ['sweet potato'], kcal: 90, p: 2, c: 20.7, f: 0.2, portions: [{ label: '1 medium', grams: 114 }] },
  { id: 'fries', name: 'French fries (fast-food style)', aliases: ['fries', 'french fries', 'chips'], kcal: 312, p: 3.4, c: 41, f: 15, portions: [{ label: 'medium serving', grams: 117 }, { label: 'large serving', grams: 154 }], generic: 'restaurant' },
  { id: 'banana', name: 'Banana', aliases: ['banana'], kcal: 89, p: 1.1, c: 22.8, f: 0.3, portions: [{ label: '1 medium', grams: 118 }] },
  { id: 'apple', name: 'Apple', aliases: ['apple'], kcal: 52, p: 0.3, c: 13.8, f: 0.2, portions: [{ label: '1 medium', grams: 182 }] },
  { id: 'berries', name: 'Mixed berries', aliases: ['berries', 'blueberries', 'strawberries'], kcal: 50, p: 0.8, c: 12, f: 0.3, portions: [{ label: '1 cup', grams: 150 }] },
  { id: 'broccoli', name: 'Broccoli, cooked', aliases: ['broccoli'], kcal: 35, p: 2.4, c: 7.2, f: 0.4, portions: [{ label: '1 cup', grams: 156 }] },
  { id: 'salad_greens', name: 'Salad greens', aliases: ['salad', 'lettuce', 'greens', 'spinach'], kcal: 17, p: 1.3, c: 3.3, f: 0.2, portions: [{ label: '2 cups', grams: 85 }] },
  { id: 'avocado', name: 'Avocado', aliases: ['avocado', 'guacamole'], kcal: 160, p: 2, c: 8.5, f: 14.7, portions: [{ label: '1/2 avocado', grams: 68 }] },
  { id: 'greek_yogurt', name: 'Greek yogurt, plain, nonfat', aliases: ['greek yogurt', 'yogurt', 'yoghurt'], kcal: 59, p: 10.2, c: 3.6, f: 0.4, portions: [{ label: '1 container', grams: 170 }] },
  { id: 'milk_2', name: 'Milk, 2%', aliases: ['milk'], kcal: 50, p: 3.3, c: 4.8, f: 2, portions: [{ label: '1 cup', grams: 244 }] },
  { id: 'cheddar', name: 'Cheddar cheese', aliases: ['cheese', 'cheddar'], kcal: 403, p: 22.9, c: 3.1, f: 33.1, portions: [{ label: '1 slice / 1 oz', grams: 28 }] },
  { id: 'peanut_butter', name: 'Peanut butter', aliases: ['peanut butter', 'pb'], kcal: 588, p: 25, c: 20, f: 50, portions: [{ label: '2 tbsp', grams: 32 }] },
  { id: 'almonds', name: 'Almonds', aliases: ['almonds', 'nuts'], kcal: 579, p: 21.2, c: 21.6, f: 49.9, portions: [{ label: '1 oz (~23 nuts)', grams: 28 }] },
  { id: 'olive_oil', name: 'Olive oil', aliases: ['olive oil', 'oil'], kcal: 884, p: 0, c: 0, f: 100, portions: [{ label: '1 tbsp', grams: 13.5 }] },
  { id: 'whey', name: 'Whey protein powder (typical)', aliases: ['protein shake', 'whey', 'protein powder', 'shake'], kcal: 400, p: 80, c: 8, f: 6, portions: [{ label: '1 scoop', grams: 30 }] },
  { id: 'protein_bar', name: 'Protein bar (typical)', aliases: ['protein bar', 'bar'], kcal: 350, p: 30, c: 35, f: 10, portions: [{ label: '1 bar', grams: 60 }] },
  { id: 'black_beans', name: 'Black beans, cooked', aliases: ['beans', 'black beans'], kcal: 132, p: 8.9, c: 23.7, f: 0.5, portions: [{ label: '1 cup', grams: 172 }] },
  { id: 'lentils', name: 'Lentils, cooked', aliases: ['lentils', 'dal', 'daal'], kcal: 116, p: 9, c: 20.1, f: 0.4, portions: [{ label: '1 cup', grams: 198 }] },
  { id: 'orange_juice', name: 'Orange juice', aliases: ['orange juice', 'oj', 'juice'], kcal: 45, p: 0.7, c: 10.4, f: 0.2, portions: [{ label: '1 cup', grams: 248 }] },
  { id: 'cola', name: 'Cola (regular)', aliases: ['soda', 'coke', 'cola', 'pop'], kcal: 42, p: 0, c: 10.6, f: 0, portions: [{ label: '1 can (12 oz)', grams: 368 }] },
  { id: 'latte', name: 'Latte with whole milk', aliases: ['latte', 'coffee with milk', 'cappuccino'], kcal: 54, p: 2.9, c: 4.3, f: 2.9, portions: [{ label: '16 oz', grams: 473 }] },
  { id: 'pizza_cheese', name: 'Cheese pizza, regular crust', aliases: ['pizza', 'cheese pizza', 'pepperoni pizza'], kcal: 266, p: 11.4, c: 33, f: 9.7, portions: [{ label: '1 slice (14")', grams: 107 }], generic: 'restaurant' },
  { id: 'burger_single', name: 'Hamburger, single patty (generic fast food)', aliases: ['burger', 'hamburger', 'cheeseburger'], kcal: 254, p: 13, c: 26, f: 11, portions: [{ label: '1 burger', grams: 120 }], generic: 'restaurant' },
  { id: 'burger_double', name: 'Double cheeseburger (generic fast food)', aliases: ['double burger', 'double cheeseburger', 'double'], kcal: 270, p: 14.6, c: 21, f: 14.5, portions: [{ label: '1 regular double', grams: 170 }, { label: '1 large/premium double', grams: 300 }], generic: 'restaurant' },
  { id: 'burrito', name: 'Chicken burrito (generic restaurant)', aliases: ['burrito'], kcal: 190, p: 10, c: 22, f: 7, portions: [{ label: '1 burrito', grams: 350 }], generic: 'restaurant' },
  { id: 'caesar_chicken', name: 'Chicken Caesar salad with dressing', aliases: ['caesar', 'caesar salad', 'chicken salad'], kcal: 140, p: 10, c: 5, f: 9, portions: [{ label: '1 bowl', grams: 300 }], generic: 'restaurant' },
  { id: 'chicken_curry', name: 'Chicken curry (homemade)', aliases: ['curry', 'chicken curry', 'tikka masala', 'butter chicken'], kcal: 150, p: 12, c: 6, f: 9, portions: [{ label: '1 bowl', grams: 300 }], generic: 'homemade' },
  { id: 'bolognese', name: 'Spaghetti bolognese', aliases: ['bolognese', 'spaghetti bolognese', 'meat sauce'], kcal: 132, p: 7, c: 15, f: 5, portions: [{ label: '1 plate', grams: 350 }], generic: 'homemade' },
  { id: 'fried_rice', name: 'Chicken fried rice', aliases: ['fried rice'], kcal: 174, p: 6.5, c: 25, f: 5.5, portions: [{ label: '1 plate', grams: 300 }], generic: 'restaurant' },
  { id: 'stir_fry', name: 'Chicken & vegetable stir-fry', aliases: ['stir fry', 'stir-fry'], kcal: 110, p: 11, c: 6, f: 4.5, portions: [{ label: '1 plate', grams: 300 }], generic: 'homemade' },
  { id: 'sandwich_turkey', name: 'Turkey sandwich', aliases: ['sandwich', 'turkey sandwich', 'sub'], kcal: 215, p: 13, c: 25, f: 7, portions: [{ label: '1 sandwich', grams: 220 }], generic: 'restaurant' },
];

/** Restaurant names we recognise in hints so the UI can say an official source should be used. */
export const RESTAURANT_BRANDS = [
  "wendy's", 'wendys', "mcdonald's", 'mcdonalds', 'burger king', 'chipotle', 'subway', 'taco bell', 'kfc', "chick-fil-a", 'chickfila', 'five guys', 'in-n-out', 'starbucks', 'panera', 'shake shack', "domino's", 'dominos', 'pizza hut', 'popeyes', 'sweetgreen', 'panda express', "arby's", 'jimmy john', "dunkin",
];

export function detectBrand(text: string): string | undefined {
  const t = text.toLowerCase();
  return RESTAURANT_BRANDS.find((b) => t.includes(b));
}
