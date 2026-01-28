import leoProfanity from "leo-profanity";

// Add any custom words specific to the raffe racing context if needed
// leoProfanity.add("customWord1");
// leoProfanity.add("customWord2");

// Remove false positives if needed (e.g., words that might be valid raffe names)
// leoProfanity.remove("hell");

/**
 * Check if a string contains profanity
 * @param text - The text to check
 * @returns true if the text contains profanity
 */
export function containsProfanity(text: string): boolean {
  return leoProfanity.check(text);
}

/**
 * Clean profanity from a string by replacing with asterisks
 * @param text - The text to clean
 * @returns The cleaned text with profanity replaced by asterisks
 */
export function cleanProfanity(text: string): string {
  return leoProfanity.clean(text);
}

/**
 * Add custom words to the filter
 * @param words - Words to add to the profanity list
 */
export function addProfanityWords(...words: string[]): void {
  words.forEach(word => leoProfanity.add(word));
}

/**
 * Remove words from the filter (for false positives)
 * @param words - Words to remove from the profanity list
 */
export function removeProfanityWords(...words: string[]): void {
  words.forEach(word => leoProfanity.remove(word));
}
