import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Airport, AirportDocument } from './airports.schema';
import { CreateAirportDto, UpdateAirportDto } from './airports.dto';

@Injectable()
export class AirportsService {
  constructor(
    @InjectModel(Airport.name) private airportModel: Model<AirportDocument>,
  ) {}

  async findAll(search?: string): Promise<Airport[]> {
    const filter: any = {};
    if (search) {
      filter.$or = [
        { iata_code: { $regex: search, $options: 'i' } },
        { city_name: { $regex: search, $options: 'i' } },
        { airport_name: { $regex: search, $options: 'i' } },
      ];
    }
    return this.airportModel.find(filter).sort({ city_name: 1 }).exec();
  }

  async findByIata(iata: string): Promise<AirportDocument> {
    const airport = await this.airportModel.findOne({ iata_code: iata.toUpperCase() }).exec();
    if (!airport) {
      throw new NotFoundException(`Airport with IATA code ${iata} not found`);
    }
    return airport;
  }

  // Requirement 3.3.1: Check city ambiguity and service availability
  async resolveCity(query: string): Promise<{
    exactMatches: Airport[];
    nearestSuggestion?: { airport: Airport; distance_km: number };
  }> {
    const directAirports = await this.airportModel
      .find({
        $or: [
          { city_name: { $regex: query, $options: 'i' } },
          { iata_code: { $regex: query, $options: 'i' } },
        ],
      })
      .exec();

    if (directAirports.length > 0) {
      return { exactMatches: directAirports };
    }

    // If city is not directly serviced, check if there's an unserviced airport entry with nearest pointer
    const unserviced = await this.airportModel
      .findOne({
        city_name: { $regex: query, $options: 'i' },
        is_serviced_directly: false,
      })
      .exec();

    if (unserviced && unserviced.nearest_airport_code) {
      const nearest = await this.airportModel.findOne({
        iata_code: unserviced.nearest_airport_code,
      }).exec();
      if (nearest) {
        return {
          exactMatches: [],
          nearestSuggestion: {
            airport: nearest,
            distance_km: unserviced.distance_to_nearest_km,
          },
        };
      }
    }

    return { exactMatches: [] };
  }

  async create(createAirportDto: CreateAirportDto): Promise<AirportDocument> {
    const existing = await this.airportModel
      .findOne({ iata_code: createAirportDto.iata_code.toUpperCase() })
      .exec();
    if (existing) {
      throw new ConflictException(`Airport with IATA ${createAirportDto.iata_code} already exists`);
    }

    const created = new this.airportModel({
      ...createAirportDto,
      iata_code: createAirportDto.iata_code.toUpperCase(),
    });
    return created.save();
  }

  async update(iata: string, updateAirportDto: UpdateAirportDto): Promise<AirportDocument> {
    const airport = await this.findByIata(iata);

    if (updateAirportDto.city_name) airport.city_name = updateAirportDto.city_name;
    if (updateAirportDto.airport_name) airport.airport_name = updateAirportDto.airport_name;
    if (updateAirportDto.is_serviced_directly !== undefined) airport.is_serviced_directly = updateAirportDto.is_serviced_directly;
    if (updateAirportDto.nearest_airport_code !== undefined) airport.nearest_airport_code = updateAirportDto.nearest_airport_code;
    if (updateAirportDto.distance_to_nearest_km !== undefined) airport.distance_to_nearest_km = updateAirportDto.distance_to_nearest_km;
    if (updateAirportDto.time_zone) airport.time_zone = updateAirportDto.time_zone;

    return airport.save();
  }

  async delete(iata: string): Promise<{ message: string }> {
    const airport = await this.findByIata(iata);
    await this.airportModel.findOneAndDelete({ iata_code: airport.iata_code }).exec();
    return { message: `Airport ${airport.iata_code} deleted successfully` };
  }
}
