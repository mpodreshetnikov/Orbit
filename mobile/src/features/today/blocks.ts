import AsyncStorage from "@react-native-async-storage/async-storage";

/** The blocks "Сегодня" can show, in the order it shows them. */
export const TODAY_BLOCKS = ["doses", "checkups"] as const;

export type TodayBlock = (typeof TODAY_BLOCKS)[number];

export type TodayBlocks = Record<TodayBlock, boolean>;

const ALL_SHOWN: TodayBlocks = { doses: true, checkups: true };

const blocksKey = (userId: string) => `orbit.today.blocks.${userId}`;

/**
 * Which blocks this phone shows on "Сегодня" for the account. Every block is shown until it is turned
 * off, and a block added later starts shown: only what was turned off is stored as off. Every block
 * is shown, too, when the stored choice cannot be read.
 */
export async function readTodayBlocks(userId: string): Promise<TodayBlocks> {
  try {
    // A phone that cannot read its own preference shows every block rather than nothing.
    const stored = await AsyncStorage.getItem(blocksKey(userId));
    if (!stored) return ALL_SHOWN;
    const parsed = JSON.parse(stored) as Partial<Record<string, unknown>>;
    return Object.fromEntries(
      TODAY_BLOCKS.map((block) => [block, parsed[block] !== false]),
    ) as TodayBlocks;
  } catch {
    return ALL_SHOWN;
  }
}

export async function writeTodayBlocks(userId: string, blocks: TodayBlocks): Promise<void> {
  await AsyncStorage.setItem(blocksKey(userId), JSON.stringify(blocks));
}
