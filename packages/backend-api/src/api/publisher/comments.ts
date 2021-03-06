/*
Copyright 2017 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as Bluebird from 'bluebird';

import { logger } from '../../logger';
import {
  Article,
  Comment,
  ICommentInstance,
} from '../../models';
import { postProcessComment } from '../../pipeline';
import { enqueueSendCommentForScoringTask } from '../../processing';

/**
 * Take a comment defintion and return a promise that either resolves
 * with the model instance on succesful insertion or a rejection if the
 * comment already exists.
 */
async function createCommentIfNew(commentData: any): Promise<ICommentInstance> {
  // Verify article existence
  const article = await Article.findOne({
    where: { sourceId: commentData.articleId },
  });

  if (!article) {
    throw new Error(`Article is not available: ${commentData.articleId}`);
  }

  // Force convert publisher data to conform to DB model
  commentData.articleId = article.id;
  commentData.sourceId = commentData.sourceId;
  commentData.replyToSourceId = commentData.replyToSourceId;
  commentData.authorSourceId = commentData.authorSourceId;
  commentData.sourceCreatedAt = commentData.createdAt;

  logger.info(`Find or create comment ${commentData.sourceId}`, commentData);

  // If article exists, find/create comment
  const [instance, created] = await Comment.findOrCreate({
    where: { sourceId: commentData.sourceId },
    defaults: commentData,
  });

  if (created) {
    logger.info(`Created comment ${instance.id}`);
  } else {
    logger.info(`Found comment ${instance.id}, not creating new record`);

    return instance;
  }

  await postProcessComment(instance);

  return instance;
}

/**
 * Given an array of comment data, return instances succesfully
 * created that weren't duplicates.
 */
export function createComments(items: Array<any>): Bluebird<Array<ICommentInstance>> {
  return Bluebird.mapSeries(items, createCommentIfNew)
      .then((createdComments) => Promise.resolve(createdComments));
}

/**
 * Send the comments to the queue for scoring.
 */
export async function sendCommentsToScoringQueue(comments: Array<ICommentInstance>): Promise<void> {
  for (const c of comments) {
    await enqueueSendCommentForScoringTask(c.id);
  }
}
