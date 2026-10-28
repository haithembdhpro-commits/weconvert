/**
 * The 69 Algerian wilayas with their official codes (58 historic + 11 created by presidential decree n° 26-206
 * of 25 May 2026, codes 59–69). Values use the "NN - Nom" format already stored on CRM orders, so the wilaya code
 * can be reused for carriers (see Shipping.tsx).
 */
const NAMES = [
  "Adrar", "Chlef", "Laghouat", "Oum El Bouaghi", "Batna", "Béjaïa", "Biskra", "Béchar", "Blida", "Bouira",
  "Tamanrasset", "Tébessa", "Tlemcen", "Tiaret", "Tizi Ouzou", "Alger", "Djelfa", "Jijel", "Sétif", "Saïda",
  "Skikda", "Sidi Bel Abbès", "Annaba", "Guelma", "Constantine", "Médéa", "Mostaganem", "M’Sila", "Mascara", "Ouargla",
  "Oran", "El Bayadh", "Illizi", "Bordj Bou Arréridj", "Boumerdès", "El Tarf", "Tindouf", "Tissemsilt", "El Oued", "Khenchela",
  "Souk Ahras", "Tipaza", "Mila", "Aïn Defla", "Naâma", "Aïn Témouchent", "Ghardaïa", "Relizane", "Timimoun", "Bordj Badji Mokhtar",
  "Ouled Djellal", "Béni Abbès", "In Salah", "In Guezzam", "Touggourt", "Djanet", "El M’Ghair", "El Meniaa", "Aflou", "Barika",
  "El Kantara", "Bir El Ater", "El Aricha", "Ksar Chellala", "Aïn Ouessara", "Messaad", "Ksar El Boukhari", "Bou Saâda", "El Abiodh Sidi Cheikh",
]

export const WILAYAS: { code: number; value: string }[] = NAMES.map((name, i) => ({ code: i + 1, value: String(i + 1).padStart(2, "0") + " - " + name }))
