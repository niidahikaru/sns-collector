import type { RawPost, GasPost, GasResponse, Platform, MetricValue } from './types';
import * as logger from './logger';

interface SenderCallbacks {
  onSendSuccess: (count: number) => void;
}

const MAX_BATCH_SIZE = 100;

export class Sender {
  private gasUrl: string;
  private platform: Platform;
  private queue: GasPost[] = [];
  private inFlight = false;
  private batchCounter = 0;
  private callbacks: SenderCallbacks;
  private account = '';
  private username = '';
  private sessionId = '';

  constructor(gasUrl: string, platform: Platform, callbacks: SenderCallbacks) {
    this.gasUrl = gasUrl;
    this.platform = platform;
    this.callbacks = callbacks;
  }

  enqueue(posts: RawPost[], account: string, username: string, sessionId: string): void {
    this.account = account;
    this.username = username;
    this.sessionId = sessionId;
    const gasPosts = posts.map((p) => this.toGasPost(p));
    this.queue.push(...gasPosts);
    this.tryFlush();
  }

  flush(): void {
    this.tryFlush();
  }

  // ---- Private ----

  private tryFlush(): void {
    if (this.inFlight || this.queue.length === 0) return;

    this.inFlight = true;
    this.batchCounter++;
    const batch = this.queue.splice(0, Math.min(MAX_BATCH_SIZE, this.queue.length));
    const batchId = this.sessionId + '_' + this.batchCounter;

    const payload = {
      posts: batch,
      account: this.account,
      username: this.username,
      sessionId: this.sessionId,
      batchId,
      platform: this.platform,
    };

    try {
      chrome.runtime.sendMessage(
        { type: 'SEND_TO_GAS', gasUrl: this.gasUrl, payload },
        (response?: GasResponse) => {
          this.inFlight = false;

          if (chrome.runtime.lastError) {
            logger.error('送信エラー:', chrome.runtime.lastError.message);
            logger.warn(`${batch.length}件の送信をスキップ`);
            return;
          }

          if (response?.success) {
            const count = response.count || batch.length;
            this.callbacks.onSendSuccess(count);
            logger.log(`${batch.length}件送信完了`);
            try {
              chrome.runtime.sendMessage({ type: 'SEND_RESULT', result: response });
            } catch {
              // popup may be closed
            }
          } else {
            logger.warn('GAS処理エラー:', response?.message);
            logger.warn(`${batch.length}件の送信をスキップ`);
          }

          if (this.queue.length > 0) {
            this.tryFlush();
          }
        },
      );
    } catch (e) {
      this.inFlight = false;
      logger.error('送信エラー:', e);
    }
  }

  private toGasPost(post: RawPost): GasPost {
    const base: GasPost = {
      postId: post.postId,
      datetime: post.datetime ? this.formatDatetime(post.datetime) : '',
      text: post.text || '',
      likes: this.formatMetric(post.likes),
      replies: this.formatMetric(post.replies),
      views: this.formatMetric(post.views),
      hasImage: post.hasMedia ? 'あり' : 'なし',
      postUrl: post.postUrl,
    };

    if (this.platform === 'x') {
      base.retweets = this.formatMetric(post.retweets);
      base.bookmarks = this.formatMetric(post.bookmarks);
    }

    return base;
  }

  private formatMetric(mv: MetricValue | undefined): string {
    if (!mv) return '0';
    return mv.raw || '0';
  }

  private formatDatetime(datetime: string): string {
    try {
      const d = new Date(datetime);
      if (isNaN(d.getTime())) return datetime;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
    } catch {
      return datetime;
    }
  }
}
