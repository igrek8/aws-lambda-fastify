import { Logger as ILogger } from "fastify";
import { flatten } from "flat";
import { Inject, Service } from "typedi";

import { CachedOmdbProvider } from "./CachedOmdbProvider";
import { Movie } from "./engine/Movie";
import { IJoynProvider } from "./IJoynProvider";
import { IOmdbProvider } from "./IOmdbProvider";
import { ISearchEngine, ISearchEngineResponse } from "./ISearchEngine";
import * as joyn from "./joyn";
import { JoynProvider } from "./JoynProvider";
import { Logger } from "./Logger";
import * as omdb from "./omdb";

/**
 * SearchEngine is a final composition that uses JoynProvider & OmdbProvider.
 * It implements search by fields and search by id methods that return combined meta
 * from Joyn & Omdb providers.
 */
@Service()
export class SearchEngine implements ISearchEngine {
  constructor(
    @Inject(() => Logger) protected readonly logger: ILogger,
    @Inject(() => JoynProvider) protected readonly joyn: IJoynProvider,
    @Inject(() => CachedOmdbProvider) protected readonly omdb: IOmdbProvider
  ) {}

  /**
   * Searches for the movie
   * @param joynIdOrImdbId joyn id or imdb id
   */
  async getMovieById(joynIdOrImdbId: string): Promise<Movie | undefined> {
    const joynMovie = await this.joyn.getMovieById(joynIdOrImdbId);
    if (!joynMovie) return undefined;
    const omdbMovie = await this.omdb.getMovieById(joynMovie.imdbId);
    if (!omdbMovie) return undefined;
    return this.mergeMovie(joynMovie, omdbMovie);
  }

  /**
   * Searches for movies based on search fields.
   * If search terms are provided the response will contain `matches` property that describes how many matches
   * the search has found.
   */
  async getMoviesBySearch(search: Record<string, string>): Promise<ISearchEngineResponse<Movie>> {
    const movies: Movie[] = await this.getMovies();
    if (Object.keys(search).length === 0) return { movies };
    const matched: Movie[] = movies.filter((movie) => this.isSearchMatch(movie, search));
    if (matched.length > 0) return { movies: matched, matches: matched.length };
    return { movies, matches: 0 };
  }

  protected async getMovies() {
    const joynMovies = await this.joyn.getMovies();
    const movies: Movie[] = [];
    for await (const joynMovie of joynMovies) {
      const omdbMovie = await this.omdb.getMovieById(joynMovie.imdbId);
      if (!omdbMovie) continue;
      const movie = this.mergeMovie(joynMovie, omdbMovie);
      movies.push(movie);
    }
    return movies;
  }

  protected isSearchMatch(movie: Movie, search: Record<string, string>): boolean {
    const obj: Record<string, number | string> = flatten(movie);
    const searchTerms = Object.entries(search);
    const movieFields = Object.entries(obj);
    for (const [searchTerm, searchFilter] of searchTerms) {
      let isMatched = false;
      for (const [fieldId, fieldValue] of movieFields) {
        /**
         * Since the structure is flat, we must at least find one match for the search term.
         * For example: ?director=Frank Miller would try to match Director.0, Director.1 and so on.
         * Therefore, Frank Miller would match Director.0
         */
        if (!this.isMatch(fieldId, searchTerm)) continue;
        if (this.isEqual(searchFilter, fieldValue)) isMatched = true;
        if (isMatched) break;
      }
      if (!isMatched) return false;
    }
    return true;
  }

  /**
   * Matches if the search_term matches the field id
   */
  protected isMatch(a: string, b: string) {
    /**
     * As per requirement, the fields are case-insensitive
     */
    return a.toLowerCase().startsWith(b.toLowerCase());
  }

  /**
   * Matches if search_term matches the field value
   */
  protected isEqual(a: string, b: string | number) {
    return b.toString().toLowerCase() === a.toLowerCase();
  }

  /**
   * Merges JoynMovie & OmdbMovie with some transformations
   */
  protected mergeMovie(joynMovie: joyn.Movie, omdbMovie: omdb.Movie): Movie {
    return {
      // JOYN
      description: omdbMovie.Plot,
      duration: joynMovie.duration,
      id: joynMovie.id,
      imdbId: joynMovie.imdbId,
      languages: joynMovie.languages,
      originalLanguage: joynMovie.originalLanguage,
      productionYear: joynMovie.productionYear,
      studios: joynMovie.studios,
      title: omdbMovie.Title,

      // OMDB
      Title: omdbMovie.Title,
      Year: omdbMovie.Year,
      Rated: omdbMovie.Rated,
      Released: omdbMovie.Released,
      Runtime: `${joynMovie.duration} min`,
      Genre: omdbMovie.Genre,
      Director: omdbMovie.Director.split(", "),
      Writer: omdbMovie.Writer.split(", "),
      Actors: omdbMovie.Actors.split(", "),
      Plot: omdbMovie.Plot,
      Language: omdbMovie.Language,
      Country: omdbMovie.Country,
      Awards: omdbMovie.Awards,
      Poster: omdbMovie.Poster,
      Ratings: [...omdbMovie.Ratings, this.mapJoynRaitngToOmdbRaiting(joynMovie.userrating)],
      Metascore: omdbMovie.Metascore,
      imdbRating: omdbMovie.imdbRating,
      imdbVotes: omdbMovie.imdbVotes,
      imdbID: omdbMovie.imdbID,
      Type: omdbMovie.Type,
      DVD: omdbMovie.DVD,
      BoxOffice: omdbMovie.BoxOffice,
      Production: omdbMovie.Production,
      Website: omdbMovie.Website,
      Response: omdbMovie.Response,
    };
  }

  /**
   * Maps joyn.Rting to match omdb.Rating interface
   */
  protected mapJoynRaitngToOmdbRaiting(rating: joyn.Rating): omdb.Rating {
    const r1 = rating.countStar1;
    const r2 = rating.countStar2;
    const r3 = rating.countStar3;
    const r4 = rating.countStar4;
    const r5 = rating.countStar5;
    const value = (5 * r5 + 4 * r4 + 3 * r3 + 2 * r2 + 1 * r1) / (r1 + r2 + r3 + r4 + r5);
    return { Source: "Joyn", Value: value.toFixed(1) + "/5.0" };
  }
}
