import type { CreateCmsChatAvatarDataOptions } from '../../services/avatar/CmsChatAvatarDataService';
import {
  getCmsChatAvatarKnowledgeBundle,
  type CmsChatAvatarKnowledgeSelection,
} from './knowledge';
import {
  getCmsChatAvatarPresentationDefinition,
  type CmsChatAvatarPresentationName,
} from './presentations';

type CmsChatAvatarScenarioData = Omit<CreateCmsChatAvatarDataOptions, 'logger'>;

export type CmsChatAvatarScenarioDefinition<TId extends string = string> = {
  data: CmsChatAvatarScenarioData;
  id: TId;
  tags: string[];
  title: string;
};

export type CmsChatAvatarScenarioBuildInput<TId extends string> = {
  data?: Partial<Omit<CmsChatAvatarScenarioData, 'knowledge' | 'presentation'>>;
  id: TId;
  knowledge?: CmsChatAvatarKnowledgeSelection;
  presentation: CmsChatAvatarPresentationName;
  tags?: string[];
  title?: string;
};

export const defineCmsChatAvatarScenario = <TId extends string>(
  input: CmsChatAvatarScenarioBuildInput<TId>,
): CmsChatAvatarScenarioDefinition<TId> => {
  const presentation = getCmsChatAvatarPresentationDefinition(input.presentation);
  const knowledge = getCmsChatAvatarKnowledgeBundle(input.knowledge);

  return {
    data: {
      ...input.data,
      knowledge: knowledge.items,
      presentation: presentation.input,
    },
    id: input.id,
    tags: [...presentation.tags, ...knowledge.tags, ...(input.tags ?? [])],
    title: input.title ?? `${presentation.title} ${knowledge.title}`,
  };
};
