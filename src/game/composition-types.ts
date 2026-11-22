import type { InteractionBinding, Position, WorldInstance } from './state';
import type { ReferenceInput, ResolutionContext } from './references';

/** Parameters are captured concrete instance references, not expressions. */
export type CompositionReference = ReferenceInput | { readonly parameter: string };
export interface CompositionOffer {
  readonly mission: string; readonly name: string; readonly target: string;
  readonly opponent: CompositionReference;
  /** Local coordinates, including future spawns. */
  readonly spawn: Position;
}
export interface CompositionDefinition {
  readonly id: string;
  readonly characters?: readonly {
    readonly key: string; readonly definitionId: string; readonly position: Position;
    readonly label?: string; readonly faction?: CompositionReference;
    readonly interactions?: readonly InteractionBinding[];
    readonly offer?: CompositionOffer;
  }[];
  readonly factions?: readonly { readonly key: string; readonly definitionId: string }[];
  readonly relations?: readonly {
    readonly key?: string; readonly definitionId: string;
    readonly source: CompositionReference; readonly target: CompositionReference;
    readonly intensity: number;
  }[];
  readonly parameters?: Readonly<Record<string, { readonly kind: WorldInstance['kind'] }>>;
  readonly roles?: Readonly<Record<string, {
    readonly kind: WorldInstance['kind']; readonly initial?: CompositionReference;
    readonly allowVacant?: boolean;
  }>>;
}
export interface CompositionConfig {
  definitionId: string;
  key?: string;
  origin: Position;
  bindings?: Readonly<Record<string, ReferenceInput>>;
  /** Only for resolving unqualified references supplied as bindings. */
  context?: ResolutionContext;
}
