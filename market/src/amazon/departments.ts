/** A top-level Amazon department and the browse node that lists it. */
export interface Department {
  slug: string;
  name: string;
  node: string;
}

/** The departments the storefront's shop-by-department menu offers. */
export const DEPARTMENTS: readonly Department[] = [
  { slug: "appliances", name: "Appliances", node: "2619525011" },
  { slug: "arts-crafts", name: "Arts, Crafts & Sewing", node: "2617941011" },
  { slug: "automotive", name: "Automotive", node: "15684181" },
  { slug: "baby", name: "Baby", node: "165796011" },
  { slug: "beauty", name: "Beauty & Personal Care", node: "3760911" },
  { slug: "books", name: "Books", node: "283155" },
  { slug: "cds-vinyl", name: "CDs & Vinyl", node: "5174" },
  {
    slug: "cell-phones",
    name: "Cell Phones & Accessories",
    node: "2335752011",
  },
  { slug: "clothing", name: "Clothing, Shoes & Jewelry", node: "7141123011" },
  { slug: "collectibles", name: "Collectibles & Fine Art", node: "4991425011" },
  { slug: "computers", name: "Computers & Accessories", node: "541966" },
  { slug: "electronics", name: "Electronics", node: "172282" },
  { slug: "garden", name: "Patio, Lawn & Garden", node: "2972638011" },
  { slug: "grocery", name: "Grocery & Gourmet Food", node: "16310101" },
  { slug: "handmade", name: "Handmade", node: "11260432011" },
  { slug: "health", name: "Health & Household", node: "3760901" },
  { slug: "home-kitchen", name: "Home & Kitchen", node: "1055398" },
  { slug: "industrial", name: "Industrial & Scientific", node: "16310091" },
  { slug: "kindle-store", name: "Kindle Store", node: "133140011" },
  { slug: "luggage", name: "Luggage & Travel Gear", node: "9479199011" },
  { slug: "movies-tv", name: "Movies & TV", node: "2625373011" },
  {
    slug: "musical-instruments",
    name: "Musical Instruments",
    node: "11091801",
  },
  { slug: "office-products", name: "Office Products", node: "1064954" },
  { slug: "pet-supplies", name: "Pet Supplies", node: "2619533011" },
  { slug: "software", name: "Software", node: "229534" },
  { slug: "sports-outdoors", name: "Sports & Outdoors", node: "3375251" },
  { slug: "tools", name: "Tools & Home Improvement", node: "228013" },
  { slug: "toys-games", name: "Toys & Games", node: "165793011" },
  { slug: "video-games", name: "Video Games", node: "468642" },
];

/** The named departments, in the order named. */
export function selectDepartments(slugs: string[]): Department[] {
  return slugs.map((slug) => {
    const wanted = slug.trim().toLowerCase();
    const department = DEPARTMENTS.find((d) => d.slug === wanted);
    if (!department) {
      throw new Error(
        `Unknown department: ${slug}. Known departments are ` +
          `${DEPARTMENTS.map((d) => d.slug).join(", ")}.`,
      );
    }
    return department;
  });
}
