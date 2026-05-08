import { getDb, enqueueSyncRecord } from '../database';
import { Person } from '../pipelines/types';

/**
 * Service for managing People locally (Relationship tracking).
 */

export class PersonService {
  /**
   * Search for people by name or nickname
   */
  static async search(query: string): Promise<Person[]> {
    query = query.trim().toLowerCase();
    if (!query) return [];

    const db = getDb();
    const rows = db.getAllSync(
      `SELECT * FROM people 
       WHERE LOWER(name) LIKE ? OR LOWER(nickname) LIKE ? 
       ORDER BY interaction_count DESC LIMIT 10`,
      [`%${query}%`, `%${query}%`]
    ) as any[];

    return rows.map(r => this.rowToModel(r));
  }

  /**
   * Get recently seen people
   */
  static async getRecent(limit: number = 20): Promise<Person[]> {
    const db = getDb();
    const rows = db.getAllSync(
      `SELECT * FROM people ORDER BY last_seen_at DESC, interaction_count DESC LIMIT ?`,
      [limit]
    ) as any[];
    return rows.map(r => this.rowToModel(r));
  }

  /**
   * Create a new person
   */
  static async create(data: Omit<Person, 'id' | 'interactionCount'>): Promise<Person> {
    const db = getDb();
    const now = new Date().toISOString();
    
    const result = db.runSync(
      `INSERT INTO people (
        name, nickname, team_role, context, 
        interaction_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name, 
        data.nickname || null, 
        data.teamRole || null, 
        data.context || null,
        0, now, now
      ]
    );
    
    const id = result.lastInsertRowId;
    enqueueSyncRecord('people', id, 'create');
    
    return {
      id,
      ...data,
      interactionCount: 0
    };
  }

  /**
   * Record an interaction, updating stats.
   * This is called by the Pipeline when a log mentions a person.
   */
  static async recordInteraction(personId: number, engagement?: number, energy?: number): Promise<void> {
    const db = getDb();
    const person = db.getFirstSync('SELECT interaction_count, avg_engagement, avg_energy FROM people WHERE id = ?', [personId]) as any;
    if (!person) return;

    const count = person.interaction_count;
    const newCount = count + 1;
    const now = new Date().toISOString();

    let newAvgEng = person.avg_engagement;
    if (engagement != null) {
      newAvgEng = count === 0 ? engagement : ((person.avg_engagement * count) + engagement) / newCount;
    }

    let newAvgEnergy = person.avg_energy;
    if (energy != null) {
      newAvgEnergy = count === 0 ? energy : ((person.avg_energy * count) + energy) / newCount;
    }

    db.runSync(
      `UPDATE people SET 
        interaction_count = ?, 
        avg_engagement = ?, 
        avg_energy = ?, 
        last_seen_at = ?,
        updated_at = ?
       WHERE id = ?`,
      [newCount, newAvgEng, newAvgEnergy, now, now, personId]
    );

    enqueueSyncRecord('people', personId, 'update');
  }

  private static rowToModel(row: any): Person {
    return {
      id: row.id,
      name: row.name,
      nickname: row.nickname,
      teamRole: row.team_role,
      context: row.context,
      interactionCount: row.interaction_count,
      avgEngagement: row.avg_engagement,
      avgEnergy: row.avg_energy,
      lastSeenAt: row.last_seen_at,
    };
  }
}
