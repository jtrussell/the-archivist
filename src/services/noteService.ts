import { supabase } from '../lib/supabase'

export async function getDeckNote(deckId: string): Promise<string> {
  const { data, error } = await supabase
    .from('deck_notes')
    .select('content')
    .eq('deck_id', deckId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load note: ${error.message}`)
  return data?.content ?? ''
}

export async function saveDeckNote(deckId: string, content: string): Promise<void> {
  if (content.trim() === '') {
    const { error } = await supabase.from('deck_notes').delete().eq('deck_id', deckId)
    if (error) throw new Error(`Failed to clear note: ${error.message}`)
    return
  }

  const { error } = await supabase
    .from('deck_notes')
    .upsert(
      { deck_id: deckId, content, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,deck_id' }
    )

  if (error) throw new Error(`Failed to save note: ${error.message}`)
}
